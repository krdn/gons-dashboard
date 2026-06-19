// Saju 삼국 분석 v0.2 — LLM narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (캐시-narrative 모듈 createNarrativeCache 로 통합):
//  - 캐시 키: (profile_id, school, frame_hash, model_id, prompt_version, algorithm_version)
//  - frame_hash: LifetimeFrame JSON.stringify 의 sha256 (학파별로 독립)
//  - cache-or-generate + budget guard + ZodError 재시도 + spend log 는 factory 가 소유.
//  - cache I/O(findCached/insertCache) + result envelope(toResult) 만 여기서 제공.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, computeFrameHash, type LifetimeFrame } from "@krdn/saju";
import { createNarrativeCache } from "@/shared/lib/saju/createNarrativeCache";
import { assertSajuBudgetOk, logSajuSpend } from "@/features/saju-reading/lib/budget";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import {
  sajuLifetimeNarrative,
  type LifetimeNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import { PROMPT_VERSION, SCHOOL_PROMPTS, type NarrativeSchool } from "./prompts";
import { SCHOOL_SCHEMAS } from "./schemas";

export type { NarrativeSchool } from "./prompts";

// MAX_NARRATIVE_TOKENS — v0.2 1500~2000자 분량.
const MAX_NARRATIVE_TOKENS = 8192;

export interface NarrativeResult {
  school: NarrativeSchool;
  narrativeText: string;
  sections: LifetimeNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
  modelId: string;
  promptVersion: number;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}

type LifetimeExtra = Record<string, never>;

const getOrBuild = createNarrativeCache<LifetimeFrame, LifetimeExtra, LifetimeNarrativeSections, NarrativeResult>({
  logTag: "saju-lifetime-narrative",
  schema: SCHOOL_SCHEMAS,
  maxTokens: MAX_NARRATIVE_TOKENS,
  assertBudget: () => assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW),
  logSpend: logSajuSpend,
  buildSystemPrompt: (school) => SCHOOL_PROMPTS[school],
  // cli-proxy-api 경유 시 system prompt 의 JSON 강제 지시가 무효화되는 이슈 회피 —
  // 동일 JSON 스키마 지시를 user message 본문 자체에 박는다 (2026-05-18 운영 관측).
  buildUserContent: ({ frame }) => `명조 분석:\n${JSON.stringify(frame, null, 2)}

위 명조를 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"1500~2000자 5문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별...},"citations":["출처1","출처2"]}`,
  findCached: ({ profileId, school, frameHash, modelId }) =>
    db.query.sajuLifetimeNarrative.findFirst({
      where: and(
        eq(sajuLifetimeNarrative.profileId, profileId),
        eq(sajuLifetimeNarrative.school, school),
        eq(sajuLifetimeNarrative.frameHash, frameHash),
        eq(sajuLifetimeNarrative.modelId, modelId),
        eq(sajuLifetimeNarrative.promptVersion, PROMPT_VERSION),
        eq(sajuLifetimeNarrative.algorithmVersion, ALGORITHM_VERSION),
      ),
    }),
  insertCache: async ({ ctx, narrativeText, sections, schoolSpecific, citations }) => {
    await db
      .insert(sajuLifetimeNarrative)
      .values({
        profileId: ctx.profileId,
        school: ctx.school,
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
          sajuLifetimeNarrative.profileId,
          sajuLifetimeNarrative.school,
          sajuLifetimeNarrative.frameHash,
          sajuLifetimeNarrative.modelId,
          sajuLifetimeNarrative.promptVersion,
          sajuLifetimeNarrative.algorithmVersion,
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

export async function getOrBuildNarrative(
  profileId: string,
  school: NarrativeSchool,
  frame: LifetimeFrame,
  modelId: string,
): Promise<NarrativeResult> {
  return getOrBuild({
    profileId,
    school,
    frame,
    frameHash: computeFrameHash(frame),
    modelId,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    extra: {},
  });
}
