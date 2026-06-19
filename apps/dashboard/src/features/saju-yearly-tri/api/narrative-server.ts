// Saju 삼국 분석 v0.3.1 — LLM yearly narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (캐시-narrative 모듈 createNarrativeCache 로 통합):
//  - 캐시 키: (profile_id, school, target_year, frame_hash, model_id,
//             prompt_version, algorithm_version)
//  - frame_hash: YearlyFrame JSON.stringify 의 sha256 (학파 + 연도별 독립)
//  - cache-or-generate + budget guard + ZodError 재시도 + spend log 는 factory 가 소유.
//  - cache I/O(findCached/insertCache) + result envelope(toResult) 만 여기서 제공.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, computeFrameHash, type YearlyFrame } from "@krdn/saju";
import { createNarrativeCache } from "@/shared/lib/saju/createNarrativeCache";
import { assertSajuBudgetOk, logSajuSpend } from "@/features/saju-reading/lib/budget";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import {
  sajuYearlyNarrative,
  type YearlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import { PROMPT_VERSION, SCHOOL_PROMPTS, type NarrativeSchool } from "./prompts";
import { SCHOOL_SCHEMAS } from "./schemas";

export type { NarrativeSchool } from "./prompts";

// MAX_NARRATIVE_TOKENS — 1200~1600자 본문.
const MAX_NARRATIVE_TOKENS = 6144;

export interface YearlyNarrativeResult {
  school: NarrativeSchool;
  targetYear: number;
  narrativeText: string;
  sections: YearlyNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
  modelId: string;
  promptVersion: number;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}

interface YearlyExtra {
  targetYear: number;
}

const getOrBuild = createNarrativeCache<YearlyFrame, YearlyExtra, YearlyNarrativeSections, YearlyNarrativeResult>({
  logTag: "saju-yearly-narrative",
  schema: SCHOOL_SCHEMAS,
  maxTokens: MAX_NARRATIVE_TOKENS,
  assertBudget: () => assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW),
  logSpend: logSajuSpend,
  buildSystemPrompt: (school) => SCHOOL_PROMPTS[school],
  buildUserContent: ({ frame, extra }) => buildYearlyUserContent(frame, extra.targetYear),
  findCached: ({ profileId, school, frameHash, modelId, extra }) =>
    db.query.sajuYearlyNarrative.findFirst({
      where: and(
        eq(sajuYearlyNarrative.profileId, profileId),
        eq(sajuYearlyNarrative.school, school),
        eq(sajuYearlyNarrative.targetYear, extra.targetYear),
        eq(sajuYearlyNarrative.frameHash, frameHash),
        eq(sajuYearlyNarrative.modelId, modelId),
        eq(sajuYearlyNarrative.promptVersion, PROMPT_VERSION),
        eq(sajuYearlyNarrative.algorithmVersion, ALGORITHM_VERSION),
      ),
    }),
  insertCache: async ({ ctx, narrativeText, sections, schoolSpecific, citations }) => {
    await db
      .insert(sajuYearlyNarrative)
      .values({
        profileId: ctx.profileId,
        school: ctx.school,
        targetYear: ctx.extra.targetYear,
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
          sajuYearlyNarrative.profileId,
          sajuYearlyNarrative.school,
          sajuYearlyNarrative.targetYear,
          sajuYearlyNarrative.frameHash,
          sajuYearlyNarrative.modelId,
          sajuYearlyNarrative.promptVersion,
          sajuYearlyNarrative.algorithmVersion,
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
function buildYearlyUserContent(frame: YearlyFrame, targetYear: number): string {
  return `${targetYear}년 세운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 세운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"1200~1600자 4~5문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별 필드...},"citations":["출처1","출처2"]}`;
}

export async function getOrBuildYearlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  frame: YearlyFrame,
  modelId: string,
): Promise<YearlyNarrativeResult> {
  return getOrBuild({
    profileId,
    school,
    frame,
    frameHash: computeFrameHash(frame),
    modelId,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    extra: { targetYear },
  });
}
