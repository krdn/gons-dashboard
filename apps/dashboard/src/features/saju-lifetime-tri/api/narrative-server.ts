// Saju 삼국 분석 v0.1 — LLM narrative 빌더/캐시 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school, frame_hash, model_id)
//  - frame_hash: LifetimeFrame JSON.stringify 의 sha256 (학파별로 독립)
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패 모두 throw → route 에서 500 + console.error
//  - 동시 cache miss 시 unique violation 회피: onConflictDoNothing
//
// SCHEMA_VERSION 별도 정책 없음 — narrative 캐시 키는 modelId 가 변하면 자동 갱신.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { LifetimeFrame } from "@gons/saju";
import { env } from "@/shared/config/env";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuLifetimeNarrative,
  type NarrativeSections,
} from "@/shared/lib/db/schema";

// Opus 4.x — temperature 매개변수 미지정 (proxy 가 400 반환).
// 모델 ID 는 env.SAJU_LLM_MODEL 단일 소스 (env 변경 시 캐시 자동 무효화).
const MODEL_ID = env.SAJU_LLM_MODEL;
const MAX_NARRATIVE_TOKENS = 4096;

export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

// LLM 응답이 prose/마크다운으로 시작/종료해도 JSON 본문을 추출한다.
// system prompt 가 "JSON 만" 지시해도 cli-proxy-api 경유 시 마크다운 헤더, 한국어
// 접두사("명조 분석 요약 ..."), ```json 펜스 등의 변형이 운영에서 관측됐다.
// 전략: 첫 '{' 부터 균형 잡힌 '}' 까지를 brace counter 로 추출. 문자열 리터럴 안의
// 중괄호와 escape 를 인식해 오추출 방지.
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("no JSON object found in LLM response");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error("unbalanced JSON object in LLM response");
}

const narrativeOutputSchema = z.object({
  narrativeText: z.string(),
  sections: z.object({
    personality: z.string(),
    career: z.string(),
    relationship: z.string(),
    health: z.string(),
    daeunSummary: z.string(),
  }),
  citations: z.array(z.string()),
});

const SCHOOL_PROMPT: Record<NarrativeSchool, string> = {
  ko: "한국식 자평+조후+신살 관점. 박재완·박청화 톤. 격국·조후·신살을 다층으로 설명.",
  "cn-ziping": "중국 자평진전·적천수 원전 톤. 격국·용신·억부 중심.",
  "cn-mangpai": "중국 맹파 단건업 체계 톤. 응기 분기 시점과 사건성 중심.",
  jp: "일본 추명학 톤. 통변성·12궁 중심, 처세 위주.",
};

export interface NarrativeResult {
  school: NarrativeSchool;
  narrativeText: string;
  sections: NarrativeSections;
  citations: string[];
  modelId: string;
  generatedAt: string;
  fromCache: boolean;
}

export async function getOrBuildNarrative(
  profileId: string,
  school: NarrativeSchool,
  frame: LifetimeFrame,
): Promise<NarrativeResult> {
  // frame_hash — LifetimeFrame 의 JSON 직렬화 후 sha256.
  //  - 학파별 LifetimeFrame 은 builder 가 고정 키 순서로 생성하므로 JSON.stringify 결정형.
  //  - frame 구조 변경 시 자동으로 모든 캐시가 무효화된다.
  //  - 향후 builder 가 비결정적 값(Map/Set/Date 등)을 주입하면 lifetime-server.ts 의
  //    inputHash 처럼 명시 정규화 (join("|")) 가 필요해진다.
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회
  const cached = await db.query.sajuLifetimeNarrative.findFirst({
    where: and(
      eq(sajuLifetimeNarrative.profileId, profileId),
      eq(sajuLifetimeNarrative.school, school),
      eq(sajuLifetimeNarrative.frameHash, frameHash),
      eq(sajuLifetimeNarrative.modelId, MODEL_ID),
    ),
  });
  if (cached) {
    return {
      school,
      narrativeText: cached.narrativeText,
      sections: cached.sectionsJsonb,
      citations: cached.citations,
      modelId: cached.modelId,
      generatedAt: cached.generatedAt.toISOString(),
      fromCache: true,
    };
  }

  // 2) miss → LLM 호출
  //
  // cli-proxy-api 경유 시 system prompt 의 "JSON 만" 지시가 약하게 적용되는
  // 회귀(2026-05-18 운영 관측: 응답 = "명조 분석 JSON 요약입니다." 12자 prose)를
  // 막기 위해:
  //  (a) user message 에서 'JSON' 키워드 제거 — prose 답변 시그널 차단
  //  (b) system prompt 에서 "JSON 객체만, prose 없이" 명시
  //
  // assistant prefill 패턴은 claude-opus-4-7 미지원으로 사용 불가
  // (proxy 가 명시 400: "This model does not support assistant message prefill").
  // 대신 응답이 prose 접두/접미를 포함하더라도 extractJsonObject 가 본문 추출.
  const systemPrompt = `당신은 ${SCHOOL_PROMPT[school]} 학파 사주 명리학자입니다.
입력으로 받은 결정형 명조 분석을 바탕으로 sections 를 한국어로 작성하세요.
출력은 반드시 아래 형식의 JSON 객체 하나만. 설명, 인사, 마크다운 펜스 없이 '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력하세요:
{"narrativeText":"전체 5문단", "sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"..."}, "citations":["출처1", "출처2"]}`;

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: MAX_NARRATIVE_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `명조 분석:\n${JSON.stringify(frame, null, 2)}`,
      },
    ],
  });

  // content[0] 가 비어있거나 text 가 아니면 JSON.parse 가 throw → route 가 500 처리.
  const firstBlock = response.content[0];
  const text =
    firstBlock && firstBlock.type === "text" ? firstBlock.text : "";

  // JSON.parse / zod.parse 실패는 그대로 throw — 호출자(route)가 catch 해 500 매핑.
  const json = JSON.parse(extractJsonObject(text));
  const parsed = narrativeOutputSchema.parse(json);

  // 3) 캐시 저장 — 동시 cache miss 시 unique violation 회피
  //    sajuLifetimeNarrative 의 uniqueIndex (profileId, school, frameHash, modelId).
  await db
    .insert(sajuLifetimeNarrative)
    .values({
      profileId,
      school,
      frameHash,
      modelId: MODEL_ID,
      narrativeText: parsed.narrativeText,
      sectionsJsonb: parsed.sections,
      citations: parsed.citations,
    })
    .onConflictDoNothing();

  return {
    school,
    narrativeText: parsed.narrativeText,
    sections: parsed.sections,
    citations: parsed.citations,
    modelId: MODEL_ID,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
