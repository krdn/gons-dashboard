// Saju 삼국 분석 v0.3.1 — LLM monthly narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (캐시-narrative 모듈 createNarrativeCache 로 통합):
//  - 캐시 키: (profile_id, school, target_year, target_month, frame_hash, model_id,
//             prompt_version, algorithm_version)
//  - frame_hash: MonthlyFrame JSON.stringify 의 sha256
//  - cache-or-generate + budget guard + ZodError 재시도 + spend log 는 factory 가 소유.
//  - cache I/O(findCached/insertCache) + result envelope(toResult) 만 여기서 제공.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, computeFrameHash, type MonthlyFrame } from "@krdn/saju";
import { createNarrativeCache, type NarrativeSchool as FactorySchool } from "@/shared/lib/saju/createNarrativeCache";
import { assertSajuBudgetOk, logSajuSpend } from "@/features/saju-reading/lib/budget";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import {
  sajuMonthlyNarrative,
  type MonthlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import { PROMPT_VERSION, SCHOOL_PROMPTS, type NarrativeSchool } from "./prompts";
import { SCHOOL_SCHEMAS } from "./schemas";

export type { NarrativeSchool } from "./prompts";

// MAX_NARRATIVE_TOKENS — 800~1200자 (yearly 1200~1600 의 2/3).
const MAX_NARRATIVE_TOKENS = 4096;

export interface MonthlyNarrativeResult {
  school: NarrativeSchool;
  targetYear: number;
  targetMonth: number;
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
  modelId: string;
  promptVersion: number;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}

interface MonthlyExtra {
  targetYear: number;
  targetMonth: number;
}

// 학파별 schoolSpecific JSON 예시 (월운).
const SCHOOL_SPECIFIC_EXAMPLE: Record<FactorySchool, string> = {
  ko: '{"joohuFocus":"...","shinsalNotes":["..."]}',
  "cn-ziping": '{"gyeokgukRationale":"...","yongshinAnalysis":"..."}',
  "cn-mangpai": '{"eventTimings":[{"period":"초순","event":"..."},{"period":"중순","event":"..."},{"period":"하순","event":"..."}]}',
  jp: '{"palaceMap":[{"palace":"...","note":"..."},{"palace":"...","note":"..."},{"palace":"...","note":"..."}]}',
};

const getOrBuild = createNarrativeCache<MonthlyFrame, MonthlyExtra, MonthlyNarrativeSections, MonthlyNarrativeResult>({
  logTag: "saju-monthly-narrative",
  schema: SCHOOL_SCHEMAS,
  maxTokens: MAX_NARRATIVE_TOKENS,
  assertBudget: () => assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW),
  logSpend: logSajuSpend,
  buildSystemPrompt: (school) => SCHOOL_PROMPTS[school],
  buildUserContent: ({ frame, school, extra }) =>
    buildMonthlyUserContent(frame, extra.targetYear, extra.targetMonth, school),
  findCached: ({ profileId, school, frameHash, modelId, extra }) =>
    db.query.sajuMonthlyNarrative.findFirst({
      where: and(
        eq(sajuMonthlyNarrative.profileId, profileId),
        eq(sajuMonthlyNarrative.school, school),
        eq(sajuMonthlyNarrative.targetYear, extra.targetYear),
        eq(sajuMonthlyNarrative.targetMonth, extra.targetMonth),
        eq(sajuMonthlyNarrative.frameHash, frameHash),
        eq(sajuMonthlyNarrative.modelId, modelId),
        eq(sajuMonthlyNarrative.promptVersion, PROMPT_VERSION),
        eq(sajuMonthlyNarrative.algorithmVersion, ALGORITHM_VERSION),
      ),
    }),
  insertCache: async ({ ctx, narrativeText, sections, schoolSpecific, citations }) => {
    await db
      .insert(sajuMonthlyNarrative)
      .values({
        profileId: ctx.profileId,
        school: ctx.school,
        targetYear: ctx.extra.targetYear,
        targetMonth: ctx.extra.targetMonth,
        frameHash: ctx.frameHash,
        modelId: ctx.modelId,
        promptVersion: PROMPT_VERSION,
        algorithmVersion: ALGORITHM_VERSION,
        narrativeText,
        sectionsJsonb: sections,
        schoolSpecificJsonb: schoolSpecific as SchoolSpecific,
        citations,
      })
      .onConflictDoUpdate({
        target: [
          sajuMonthlyNarrative.profileId,
          sajuMonthlyNarrative.school,
          sajuMonthlyNarrative.targetYear,
          sajuMonthlyNarrative.targetMonth,
          sajuMonthlyNarrative.frameHash,
          sajuMonthlyNarrative.modelId,
          sajuMonthlyNarrative.promptVersion,
          sajuMonthlyNarrative.algorithmVersion,
        ],
        set: {
          narrativeText,
          sectionsJsonb: sections,
          schoolSpecificJsonb: schoolSpecific as SchoolSpecific,
          citations,
          generatedAt: new Date(),
        },
      });
  },
  toResult: (payload, meta) => ({
    school: meta.ctx.school,
    targetYear: meta.ctx.extra.targetYear,
    targetMonth: meta.ctx.extra.targetMonth,
    narrativeText: payload.narrativeText,
    sections: payload.sections,
    schoolSpecific: payload.schoolSpecific as SchoolSpecific,
    citations: payload.citations,
    modelId: meta.modelId,
    promptVersion: meta.promptVersion,
    algorithmVersion: meta.algorithmVersion,
    generatedAt: meta.generatedAt,
    fromCache: meta.fromCache,
  }),
});

// cli-proxy-api 경유 시 system prompt JSON 강제 지시 무효화 회피 — user message 본문에 박는다.
function buildMonthlyUserContent(
  frame: MonthlyFrame,
  targetYear: number,
  targetMonth: number,
  school: NarrativeSchool,
): string {
  return `${targetYear}년 ${targetMonth}월 월운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 ${targetMonth}월 월운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"800~1200자 3문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["주의1","주의2"]},"schoolSpecific":${SCHOOL_SPECIFIC_EXAMPLE[school]},"citations":["출처1","출처2"]}`;
}

export async function getOrBuildMonthlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  targetMonth: number,
  frame: MonthlyFrame,
  modelId: string,
): Promise<MonthlyNarrativeResult> {
  return getOrBuild({
    profileId,
    school,
    frame,
    frameHash: computeFrameHash(frame),
    modelId,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    extra: { targetYear, targetMonth },
  });
}
