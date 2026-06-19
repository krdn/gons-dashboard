// v0.3.x — LLM daily narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (캐시-narrative 모듈 createNarrativeCache 로 통합):
//  - 캐시 키: (profile_id, school, for_date, frame_hash, model_id,
//             prompt_version, algorithm_version)
//  - frame_hash: DailyLiteFrame JSON.stringify 의 sha256
//  - cache-or-generate + budget guard + ZodError 재시도 + spend log 는 factory 가 소유.
//  - cache I/O(findCached/insertCache) + result envelope(toResult) 만 여기서 제공.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, computeFrameHash, type DailyLiteFrame } from "@krdn/saju";
import { createNarrativeCache, type NarrativeSchool as FactorySchool } from "@/shared/lib/saju/createNarrativeCache";
import { assertSajuBudgetOk, logSajuSpend } from "@/features/saju-reading/lib/budget";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import {
  sajuDailyNarrative,
  type MonthlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import { PROMPT_VERSION, SCHOOL_PROMPTS, type NarrativeSchool } from "./prompts";
import { SCHOOL_SCHEMAS } from "./schemas";

export type { NarrativeSchool } from "./prompts";

const MAX_NARRATIVE_TOKENS = 4096;

export interface DailyNarrativeResult {
  school: NarrativeSchool;
  forDate: string;
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

interface DailyExtra {
  forDate: string;
}

// 학파별 schoolSpecific JSON 예시 (일운).
const SCHOOL_SPECIFIC_EXAMPLE: Record<FactorySchool, string> = {
  ko: '{"joohuFocus":"...","shinsalNotes":["..."]}',
  "cn-ziping": '{"gyeokgukRationale":"...","yongshinAnalysis":"..."}',
  "cn-mangpai": '{"eventTimings":[{"period":"오전","event":"..."},{"period":"정오","event":"..."},{"period":"오후","event":"..."}]}',
  jp: '{"palaceMap":[{"palace":"...","note":"..."},{"palace":"...","note":"..."},{"palace":"...","note":"..."}]}',
};

const getOrBuild = createNarrativeCache<DailyLiteFrame, DailyExtra, MonthlyNarrativeSections, DailyNarrativeResult>({
  logTag: "saju-daily-narrative",
  schema: SCHOOL_SCHEMAS,
  maxTokens: MAX_NARRATIVE_TOKENS,
  assertBudget: () => assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW),
  logSpend: logSajuSpend,
  buildSystemPrompt: (school) => SCHOOL_PROMPTS[school],
  buildUserContent: ({ frame, school, extra }) => buildDailyUserContent(frame, extra.forDate, school),
  findCached: ({ profileId, school, frameHash, modelId, extra }) =>
    db.query.sajuDailyNarrative.findFirst({
      where: and(
        eq(sajuDailyNarrative.profileId, profileId),
        eq(sajuDailyNarrative.school, school),
        eq(sajuDailyNarrative.forDate, extra.forDate),
        eq(sajuDailyNarrative.frameHash, frameHash),
        eq(sajuDailyNarrative.modelId, modelId),
        eq(sajuDailyNarrative.promptVersion, PROMPT_VERSION),
        eq(sajuDailyNarrative.algorithmVersion, ALGORITHM_VERSION),
      ),
    }),
  insertCache: async ({ ctx, narrativeText, sections, schoolSpecific, citations }) => {
    await db
      .insert(sajuDailyNarrative)
      .values({
        profileId: ctx.profileId,
        school: ctx.school,
        forDate: ctx.extra.forDate,
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
          sajuDailyNarrative.profileId,
          sajuDailyNarrative.school,
          sajuDailyNarrative.forDate,
          sajuDailyNarrative.frameHash,
          sajuDailyNarrative.modelId,
          sajuDailyNarrative.promptVersion,
          sajuDailyNarrative.algorithmVersion,
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
    forDate: meta.ctx.extra.forDate,
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
function buildDailyUserContent(frame: DailyLiteFrame, forDate: string, school: NarrativeSchool): string {
  return `${forDate} 일운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${forDate} 일운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"800~1200자 3문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["주의1","주의2"]},"schoolSpecific":${SCHOOL_SPECIFIC_EXAMPLE[school]},"citations":["출처1","출처2"]}`;
}

export async function getOrBuildDailyNarrative(
  profileId: string,
  school: NarrativeSchool,
  forDate: string,
  frame: DailyLiteFrame,
  modelId: string,
): Promise<DailyNarrativeResult> {
  return getOrBuild({
    profileId,
    school,
    frame,
    frameHash: computeFrameHash(frame),
    modelId,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    extra: { forDate },
  });
}
