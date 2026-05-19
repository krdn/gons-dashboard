// Saju 삼국 분석 v0.3 — LLM tri 일진 narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (yearly narrative-server 미러링 + sections 제거):
//  - 캐시 키: (profile_id, school, for_date, frame_hash, model_id, algorithm_version)
//  - frame_hash: DailyLiteFrame JSON.stringify 의 sha256 (학파 + 날짜별 독립)
//  - miss 시 Anthropic SDK 호출 → text 추출 후 캐시 저장
//  - DailyLiteFrame 은 단순화 frame 이라 narrative 도 plain text (yearly 의 sections 없음)
//  - LLM 실패는 throw → cron route 가 isolate 후 results[].status='error' 로 격리
//  - 동시 cache miss 시 unique violation 회피: onConflictDoNothing
//
// MAX_NARRATIVE_TOKENS 축소 (yearly 4096 → 1024) — 일진은 1-2 문단 짧은 분량.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, type DailyLiteFrame } from "@gons/saju";
import { env } from "@/shared/config/env";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import { sajuDailyNarrative } from "@/shared/lib/db/schema";

const MODEL_ID = env.SAJU_LLM_MODEL;
const MAX_NARRATIVE_TOKENS = 1024;

// CHECK constraint: school IN ('ko','cn-ziping','cn-mangpai','jp')
export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

// 학파별 톤 — "이번 날 하루" 관점.
const SCHOOL_PROMPT: Record<NarrativeSchool, string> = {
  ko: "한국식 자평+조후+신살 관점. 박재완·박청화 톤. 일진 간지와 용신 충합으로 본 오늘 하루.",
  "cn-ziping": "중국 자평진전 톤. 일진 간지가 용신/격국에 미치는 영향 중심의 오늘 하루.",
  "cn-mangpai": "중국 맹파 단건업 체계 톤. 응기(應期) 관점에서 오늘 일진의 사건성.",
  jp: "일본 추명학 톤. 통변성 중심의 오늘 하루 처세 지침.",
};

export interface DailyNarrativeResult {
  school: NarrativeSchool;
  forDate: string;
  narrativeText: string;
  modelId: string;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}

export async function getOrBuildDailyNarrative(
  profileId: string,
  school: NarrativeSchool,
  forDate: string,
  frame: DailyLiteFrame,
): Promise<DailyNarrativeResult> {
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회 — (profileId, school, forDate, frameHash, modelId, algorithmVersion) UNIQUE
  const cached = await db.query.sajuDailyNarrative.findFirst({
    where: and(
      eq(sajuDailyNarrative.profileId, profileId),
      eq(sajuDailyNarrative.school, school),
      eq(sajuDailyNarrative.forDate, forDate),
      eq(sajuDailyNarrative.frameHash, frameHash),
      eq(sajuDailyNarrative.modelId, MODEL_ID),
      eq(sajuDailyNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    return {
      school,
      forDate,
      narrativeText: cached.narrativeText,
      modelId: cached.modelId,
      algorithmVersion: cached.algorithmVersion,
      generatedAt: cached.generatedAt.toISOString(),
      fromCache: true,
    };
  }

  // 2) miss → LLM 호출. yearly/monthly 와 달리 JSON 강제 없음 — plain text 1-2 문단.
  const systemPrompt = `당신은 ${SCHOOL_PROMPT[school]} 학파 사주 명리학자입니다.
입력으로 받은 ${forDate} 일진 분석을 바탕으로 오늘 하루 운세를 한국어로 1-2 문단(150-300자) 작성하세요.
마크다운 헤더, 펜스, 인사말, JSON 모두 금지 — 본문 문장만.`;

  const userContent = `${forDate} 일진 분석:\n${JSON.stringify(frame, null, 2)}

위 일진 분석을 1-2 문단으로 풀어쓰세요. 일진 간지 ${frame.dayGanji.stem}${frame.dayGanji.branch} 의 dayVibe (${frame.dayVibe}) 가 사용자에게 어떻게 작용할지 학파 톤으로 설명하세요.`;

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: MAX_NARRATIVE_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const firstBlock = response.content[0];
  const text =
    firstBlock && firstBlock.type === "text" ? firstBlock.text.trim() : "";
  if (!text) {
    throw new Error("empty narrative from LLM");
  }

  // 3) 캐시 저장 — 동시 cache miss 시 unique violation 회피
  await db
    .insert(sajuDailyNarrative)
    .values({
      profileId,
      school,
      forDate,
      frameHash,
      modelId: MODEL_ID,
      algorithmVersion: ALGORITHM_VERSION,
      narrativeText: text,
    })
    .onConflictDoNothing();

  return {
    school,
    forDate,
    narrativeText: text,
    modelId: MODEL_ID,
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
