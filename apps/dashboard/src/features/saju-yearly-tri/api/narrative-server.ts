// Saju 삼국 분석 v0.2 — LLM yearly narrative 빌더/캐시 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school, target_year, frame_hash, model_id)
//  - frame_hash: YearlyFrame JSON.stringify 의 sha256 (학파 + 연도별 독립)
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패 모두 throw → route 에서 500 + console.error
//  - 동시 cache miss 시 unique violation 회피: onConflictDoNothing
//
// v0.1 narrative-server.ts 와의 차이:
//  - LifetimeFrame → YearlyFrame 입력
//  - target_year 가 cache key 에 포함 (같은 frame_hash 라도 연도가 다르면 별도 row)
//  - SCHOOL_PROMPT 의 톤은 "올해 한 해" 운세에 맞춰 재작성 (sections 키는 lifetime 과 호환)
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ALGORITHM_VERSION, type YearlyFrame } from "@gons/saju";
import { env } from "@/shared/config/env";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuYearlyNarrative,
  type YearlyNarrativeSections,
} from "@/shared/lib/db/schema";

// Opus 4.x — temperature 매개변수 미지정 (proxy 가 400 반환). v0.1 과 동일 모델/제약.
const MODEL_ID = env.SAJU_LLM_MODEL;
const MAX_NARRATIVE_TOKENS = 4096;

// CHECK constraint: school IN ('ko','cn-ziping','cn-mangpai','jp') — narrative 는 compose 제외.
// v0.1 NarrativeSchool 과 정확히 같은 union — 향후 type 통합 시 shared 로 승격 가능.
export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

// v0.1 의 extractJsonObject 는 동일 동작이 필요하지만 cross-feature import 는 FSD
// boundary 위반. 의도적 코드 복제 (Phase 3 결정사항과 일관).
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

// yearly sections 는 5필드 (YearlyNarrativeSections) — v0.2 에서 lifetime (7필드)과 분리.
// UI 는 공통 5필드(personality/career/relationship/health/daeunSummary)만 렌더링하므로
// LifetimeFrameView 컴포넌트 재사용 가능.
// 단 의미는 다르게 — yearly 의 narrativeText 와 각 section 은 "올해 한 해" 관점.
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

// 학파별 톤 — v0.1 lifetime SCHOOL_PROMPT 와 동일 어휘 유지하되 yearly 관점 명시.
const SCHOOL_PROMPT: Record<NarrativeSchool, string> = {
  ko: "한국식 자평+조후+신살 관점. 박재완·박청화 톤. 격국·조후·신살을 다층으로 적용한 올해 한 해 운세.",
  "cn-ziping": "중국 자평진전·적천수 원전 톤. 격국·용신·억부 중심으로 본 올해 세운(歲運).",
  "cn-mangpai": "중국 맹파 단건업 체계 톤. 응기 분기 시점과 사건성 중심의 올해 운세.",
  jp: "일본 추명학 톤. 통변성·12궁 중심, 처세 위주의 올해 한 해 지침.",
};

export interface YearlyNarrativeResult {
  school: NarrativeSchool;
  targetYear: number;
  narrativeText: string;
  sections: YearlyNarrativeSections;
  citations: string[];
  modelId: string;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}

export async function getOrBuildYearlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  frame: YearlyFrame,
): Promise<YearlyNarrativeResult> {
  // frame_hash — YearlyFrame 의 JSON 직렬화 후 sha256.
  //  - builder 가 고정 키 순서로 생성하므로 JSON.stringify 결정형.
  //  - frame 구조 변경 시 자동으로 모든 캐시가 무효화된다.
  //  - 향후 builder 가 비결정적 값을 주입하면 명시 정규화 (join("|")) 가 필요해진다.
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회 — (profileId, school, targetYear, frameHash, modelId) UNIQUE
  const cached = await db.query.sajuYearlyNarrative.findFirst({
    where: and(
      eq(sajuYearlyNarrative.profileId, profileId),
      eq(sajuYearlyNarrative.school, school),
      eq(sajuYearlyNarrative.targetYear, targetYear),
      eq(sajuYearlyNarrative.frameHash, frameHash),
      eq(sajuYearlyNarrative.modelId, MODEL_ID),
      eq(sajuYearlyNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    return {
      school,
      targetYear,
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
  // 2026-05-18 운영에서 관측됨 (v0.1 PR #76 패턴). 회피: 동일 JSON 스키마 지시를
  // user message 본문 자체에 박는다. v0.1 narrative-server.ts 와 동일 전략.
  const systemPrompt = `당신은 ${SCHOOL_PROMPT[school]} 학파 사주 명리학자입니다.
입력으로 받은 ${targetYear}년 결정형 세운 분석을 바탕으로 sections 를 한국어로 작성하세요.`;

  const userContent = `${targetYear}년 세운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 세운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"올해 한 해 5문단 요약","sections":{"personality":"올해 드러나는 기질·태도","career":"직업·재물 흐름","relationship":"인연·가족 관계","health":"건강 주의점","daeunSummary":"현 대운 구간이 올해에 미치는 영향"},"citations":["출처1","출처2"]}`;

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

  // content[0] 가 비어있거나 text 가 아니면 JSON.parse 가 throw → route 가 500 처리.
  const firstBlock = response.content[0];
  const text =
    firstBlock && firstBlock.type === "text" ? firstBlock.text : "";

  // JSON.parse / zod.parse 실패는 그대로 throw — 호출자(route)가 catch 해 500 매핑.
  const json = JSON.parse(extractJsonObject(text));
  const parsed = narrativeOutputSchema.parse(json);

  // 3) 캐시 저장 — 동시 cache miss 시 unique violation 회피
  //    sajuYearlyNarrative 의 uniqueIndex (profileId, school, targetYear, frameHash, modelId).
  await db
    .insert(sajuYearlyNarrative)
    .values({
      profileId,
      school,
      targetYear,
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
    narrativeText: parsed.narrativeText,
    sections: parsed.sections,
    citations: parsed.citations,
    modelId: MODEL_ID,
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
