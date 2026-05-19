// Saju 삼국 분석 v0.3 — LLM monthly narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (yearly narrative-server.ts 미러링):
//  - 캐시 키: (profile_id, school, target_year, target_month, frame_hash, model_id,
//             algorithm_version)
//  - frame_hash: MonthlyFrame JSON.stringify 의 sha256
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패는 throw → route 가 500 + console.error
//  - 동시 cache miss 시 unique violation 회피: onConflictDoNothing
//
// yearly 와의 차이:
//  - target_month 가 cache key 와 hash 에 추가됨
//  - SCHOOL_PROMPT 의 톤은 "이번 달 한 달" 운세에 맞춰 재작성 (sections 키는 yearly 와 동일)
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ALGORITHM_VERSION, type MonthlyFrame } from "@gons/saju";
import { env } from "@/shared/config/env";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuMonthlyNarrative,
  type MonthlyNarrativeSections,
} from "@/shared/lib/db/schema";

// Opus 4.x — temperature 매개변수 미지정 (proxy 가 400 반환). yearly 와 동일 모델/제약.
const MODEL_ID = env.SAJU_LLM_MODEL;
const MAX_NARRATIVE_TOKENS = 4096;

// CHECK constraint: school IN ('ko','cn-ziping','cn-mangpai','jp') — narrative 는 compose 제외.
export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

// yearly narrative-server.ts 의 extractJsonObject 와 동일 동작이 필요하지만 cross-feature
// import 는 FSD boundary 위반. 의도적 코드 복제 (Phase 3 결정사항).
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

// 학파별 톤 — yearly SCHOOL_PROMPT 와 동일 어휘 유지하되 "이번 달" 관점 명시.
const SCHOOL_PROMPT: Record<NarrativeSchool, string> = {
  ko: "한국식 자평+조후+신살 관점. 박재완·박청화 톤. 격국·조후·신살을 다층으로 적용한 이번 달 한 달 운세.",
  "cn-ziping": "중국 자평진전·적천수 원전 톤. 격국·용신·억부 중심으로 본 이번 달 월운(月運).",
  "cn-mangpai": "중국 맹파 단건업 체계 톤. 응기 분기 시점과 사건성 중심의 이번 달 운세.",
  jp: "일본 추명학 톤. 통변성·12궁 중심, 처세 위주의 이번 달 한 달 지침.",
};

export interface MonthlyNarrativeResult {
  school: NarrativeSchool;
  targetYear: number;
  targetMonth: number;
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  citations: string[];
  modelId: string;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}

export async function getOrBuildMonthlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  targetMonth: number,
  frame: MonthlyFrame,
): Promise<MonthlyNarrativeResult> {
  // frame_hash — MonthlyFrame JSON 직렬화 후 sha256.
  // builder 가 고정 키 순서로 생성하므로 JSON.stringify 결정형.
  // frame 구조 변경 시 자동으로 모든 캐시 무효화.
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회 — (profileId, school, targetYear, targetMonth, frameHash, modelId,
  //                algorithmVersion) UNIQUE
  const cached = await db.query.sajuMonthlyNarrative.findFirst({
    where: and(
      eq(sajuMonthlyNarrative.profileId, profileId),
      eq(sajuMonthlyNarrative.school, school),
      eq(sajuMonthlyNarrative.targetYear, targetYear),
      eq(sajuMonthlyNarrative.targetMonth, targetMonth),
      eq(sajuMonthlyNarrative.frameHash, frameHash),
      eq(sajuMonthlyNarrative.modelId, MODEL_ID),
      eq(sajuMonthlyNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    return {
      school,
      targetYear,
      targetMonth,
      narrativeText: cached.narrativeText,
      sections: cached.sectionsJsonb,
      citations: cached.citations,
      modelId: cached.modelId,
      algorithmVersion: cached.algorithmVersion,
      generatedAt: cached.generatedAt.toISOString(),
      fromCache: true,
    };
  }

  // 2) miss → LLM 호출
  //
  // cli-proxy-api 경유 시 system prompt 의 JSON 강제 지시가 무효화되는 이슈가
  // 2026-05-18 운영에서 관측됨 (yearly/lifetime 과 동일 전략). 회피: JSON 스키마
  // 지시를 user message 본문에 박는다.
  const systemPrompt = `당신은 ${SCHOOL_PROMPT[school]} 학파 사주 명리학자입니다.
입력으로 받은 ${targetYear}년 ${targetMonth}월 결정형 월운 분석을 바탕으로 sections 를 한국어로 작성하세요.`;

  const userContent = `${targetYear}년 ${targetMonth}월 월운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 ${targetMonth}월 월운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"이번 달 한 달 5문단 요약","sections":{"personality":"이번 달 드러나는 기질·태도","career":"직업·재물 흐름","relationship":"인연·가족 관계","health":"건강 주의점","daeunSummary":"현 대운 구간이 이번 달에 미치는 영향"},"citations":["출처1","출처2"]}`;

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: MAX_NARRATIVE_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const firstBlock = response.content[0];
  const text =
    firstBlock && firstBlock.type === "text" ? firstBlock.text : "";

  // JSON.parse / zod.parse 실패는 그대로 throw — 호출자(route)가 catch 해 500 매핑.
  const json = JSON.parse(extractJsonObject(text));
  const parsed = narrativeOutputSchema.parse(json);

  // 3) 캐시 저장 — 동시 cache miss 시 unique violation 회피
  await db
    .insert(sajuMonthlyNarrative)
    .values({
      profileId,
      school,
      targetYear,
      targetMonth,
      frameHash,
      modelId: MODEL_ID,
      algorithmVersion: ALGORITHM_VERSION,
      narrativeText: parsed.narrativeText,
      sectionsJsonb: parsed.sections,
      citations: parsed.citations,
    })
    .onConflictDoNothing();

  return {
    school,
    targetYear,
    targetMonth,
    narrativeText: parsed.narrativeText,
    sections: parsed.sections,
    citations: parsed.citations,
    modelId: MODEL_ID,
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
