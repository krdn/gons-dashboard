// Saju 삼국 분석 v0.3.1 — LLM monthly narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (yearly narrative-server.ts 미러링):
//  - 캐시 키: (profile_id, school, target_year, target_month, frame_hash, model_id,
//             prompt_version, algorithm_version)
//  - frame_hash: MonthlyFrame JSON.stringify 의 sha256
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패는 throw → route 가 500 + console.error
//  - 동시 cache miss / null schoolSpecific 자가 치유: onConflictDoUpdate
//
// v0.3 와의 차이:
//  - prompts.ts 분리 (PROMPT_VERSION=2 + 학파별 BODY)
//  - schemas.ts 분리 (학파별 schoolSpecific union)
//  - sections 에 keyTerms + cautions 추가
//  - sajuMonthlyNarrative 컬럼에 prompt_version + school_specific_jsonb 추가
//  - MAX_NARRATIVE_TOKENS 4096 → 4096 (분량 800~1200자 = yearly 1200~1600 의 2/3)
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { ALGORITHM_VERSION, type MonthlyFrame } from "@gons/saju";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuMonthlyNarrative,
  type MonthlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  PROMPT_VERSION,
  SCHOOL_PROMPTS,
  type NarrativeSchool,
} from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";

// 모델 ID 는 호출자(API route)가 명시 전달 — v0.3.2: 사용자가 선택한 모델 (Claude/Codex/Gemini).
const MAX_NARRATIVE_TOKENS = 4096;

export type { NarrativeSchool } from "./prompts";



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

// Hotfix #3: lifetime/yearly 의 retry helper 패턴 미러 — ZodError 시 1회 재시도.
async function callMonthlyLlmAndParseWithRetry(
  school: NarrativeSchool,
  systemPrompt: string,
  baseUserContent: string,
  modelId: string,
): Promise<NarrativeOutput> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userContent =
      attempt === 1
        ? baseUserContent
        : `${baseUserContent}\n\n[중요 — 재시도] 이전 응답이 schema 검증에 실패했습니다. 모든 sections 필드를 충분한 분량으로 채우고, schoolSpecific 의 모든 필드를 빠짐없이 작성하세요. 출력은 JSON 본문만.\n\n검증 실패 상세: ${lastErr instanceof ZodError ? lastErr.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(lastErr)}`;

    try {
      const { object } = await analyzeStructured(
        userContent,
        SCHOOL_SCHEMAS[school] as import("zod").ZodType<NarrativeOutput>,
        {
          ...gatewayDefaults,
          model: modelId,
          systemPrompt,
          maxOutputTokens: MAX_NARRATIVE_TOKENS,
        },
      );
      return object as NarrativeOutput;
    } catch (err) {
      lastErr = err;
      if (err instanceof ZodError) {
        console.error(
          `[saju-monthly-narrative] ZOD_FAIL model=${modelId} school=${school} attempt=${attempt}: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
        if (attempt === 2) throw err;
      } else {
        console.error(
          `[saju-monthly-narrative] LLM_FAIL model=${modelId} school=${school} attempt=${attempt}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }
  }
  throw lastErr ?? new Error("LLM retry loop exited without result");
}

export async function getOrBuildMonthlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  targetMonth: number,
  frame: MonthlyFrame,
  modelId: string,
): Promise<MonthlyNarrativeResult> {
  // frame_hash — MonthlyFrame JSON 직렬화 후 sha256.
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회 — promptVersion 필터로 v1 row 제외.
  const cached = await db.query.sajuMonthlyNarrative.findFirst({
    where: and(
      eq(sajuMonthlyNarrative.profileId, profileId),
      eq(sajuMonthlyNarrative.school, school),
      eq(sajuMonthlyNarrative.targetYear, targetYear),
      eq(sajuMonthlyNarrative.targetMonth, targetMonth),
      eq(sajuMonthlyNarrative.frameHash, frameHash),
      eq(sajuMonthlyNarrative.modelId, modelId),
      eq(sajuMonthlyNarrative.promptVersion, PROMPT_VERSION),
      eq(sajuMonthlyNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    if (!cached.schoolSpecificJsonb) {
      // 이론상 도달 불가 (PROMPT_VERSION=2 필터로 v1 row 제외).
      console.warn(
        "[saju/monthly-narrative] v2 row with null schoolSpecific — falling through to regen",
        {
          profileId,
          school,
          targetYear,
          targetMonth,
          promptVersion: cached.promptVersion,
        },
      );
    } else {
      return {
        school,
        targetYear,
        targetMonth,
        narrativeText: cached.narrativeText,
        sections: cached.sectionsJsonb,
        schoolSpecific: cached.schoolSpecificJsonb,
        citations: cached.citations,
        modelId: cached.modelId,
        promptVersion: cached.promptVersion,
        algorithmVersion: cached.algorithmVersion,
        generatedAt: cached.generatedAt.toISOString(),
        fromCache: true,
      };
    }
  }

  // 2) miss → LLM 호출. cli-proxy-api system prompt JSON 무효화 회피 (yearly/lifetime 과 동일).
  // Hotfix #3 (v0.3.1.1): ZodError 발생 시 1회 재시도 (lifetime/yearly 패턴 미러).
  const systemPrompt = SCHOOL_PROMPTS[school];

  const schoolSpecificExample: Record<NarrativeSchool, string> = {
    ko: '{"joohuFocus":"...","shinsalNotes":["..."]}',
    "cn-ziping": '{"gyeokgukRationale":"...","yongshinAnalysis":"..."}',
    "cn-mangpai": '{"eventTimings":[{"period":"초순","event":"..."},{"period":"중순","event":"..."},{"period":"하순","event":"..."}]}',
    jp: '{"palaceMap":[{"palace":"...","note":"..."},{"palace":"...","note":"..."},{"palace":"...","note":"..."}]}',
  };

  const baseUserContent = `${targetYear}년 ${targetMonth}월 월운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 ${targetMonth}월 월운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"800~1200자 3문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["주의1","주의2"]},"schoolSpecific":${schoolSpecificExample[school]},"citations":["출처1","출처2"]}`;

  const parsed = await callMonthlyLlmAndParseWithRetry(school, systemPrompt, baseUserContent, modelId);

  // 3) 캐시 저장 — onConflictDoUpdate 로 자가 치유 (yearly 와 동일 패턴).
  await db
    .insert(sajuMonthlyNarrative)
    .values({
      profileId,
      school,
      targetYear,
      targetMonth,
      frameHash,
      modelId,
      promptVersion: PROMPT_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      narrativeText: parsed.narrativeText,
      sectionsJsonb: parsed.sections,
      schoolSpecificJsonb: parsed.schoolSpecific,
      citations: parsed.citations,
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
        narrativeText: parsed.narrativeText,
        sectionsJsonb: parsed.sections,
        schoolSpecificJsonb: parsed.schoolSpecific,
        citations: parsed.citations,
        generatedAt: new Date(),
      },
    });

  return {
    school,
    targetYear,
    targetMonth,
    narrativeText: parsed.narrativeText,
    sections: parsed.sections,
    schoolSpecific: parsed.schoolSpecific,
    citations: parsed.citations,
    modelId,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
