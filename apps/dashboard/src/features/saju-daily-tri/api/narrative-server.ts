// v0.3.x — LLM daily narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (monthly narrative-server.ts 1:1 미러):
//  - 캐시 키: (profile_id, school, for_date, frame_hash, model_id,
//             prompt_version, algorithm_version)
//  - frame_hash: DailyLiteFrame JSON.stringify 의 sha256
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패는 throw → route 가 500 + console.error
//  - 동시 cache miss / null schoolSpecific 자가 치유: onConflictDoUpdate
//
// v0.3 초기 plain-text 모델에서 v0.3.x richer 모델로 완전 재작성. 마이그레이션은
// 기존 row 를 DELETE 하여 cache key 충돌 회피.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { ALGORITHM_VERSION, type DailyLiteFrame } from "@gons/saju";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuDailyNarrative,
  type MonthlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  PROMPT_VERSION,
  SCHOOL_PROMPTS,
  type NarrativeSchool,
} from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";

const MAX_NARRATIVE_TOKENS = 4096;

export type { NarrativeSchool } from "./prompts";

// monthly narrative-server.ts 와 동일 동작. cross-feature import 는 FSD boundary 위반 — 의도적 복제.
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

async function callDailyLlmAndParseWithRetry(
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

    let response;
    try {
      response = await anthropic.messages.create({
        model: modelId,
        max_tokens: MAX_NARRATIVE_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });
    } catch (err) {
      console.error(
        `[saju-daily-narrative] LLM_CALL_FAIL model=${modelId} school=${school} attempt=${attempt}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock ? textBlock.text : "";
    const stopReason = response.stop_reason;

    try {
      const json = JSON.parse(extractJsonObject(text));
      return SCHOOL_SCHEMAS[school].parse(json) as NarrativeOutput;
    } catch (err) {
      lastErr = err;
      if (err instanceof ZodError) {
        console.error(
          `[saju-daily-narrative] ZOD_FAIL model=${modelId} school=${school} attempt=${attempt} stop=${stopReason} text_len=${text.length}: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
        if (attempt === 2) throw err;
      } else {
        console.error(
          `[saju-daily-narrative] JSON_PARSE_FAIL model=${modelId} school=${school} attempt=${attempt} stop=${stopReason} text_len=${text.length} text_head=${JSON.stringify(text.slice(0, 200))}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }
  }
  throw lastErr ?? new Error("LLM retry loop exited without result");
}

export async function getOrBuildDailyNarrative(
  profileId: string,
  school: NarrativeSchool,
  forDate: string,
  frame: DailyLiteFrame,
  modelId: string,
): Promise<DailyNarrativeResult> {
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회 — promptVersion 필터로 마이그레이션 직후 새 row 부터 시작.
  const cached = await db.query.sajuDailyNarrative.findFirst({
    where: and(
      eq(sajuDailyNarrative.profileId, profileId),
      eq(sajuDailyNarrative.school, school),
      eq(sajuDailyNarrative.forDate, forDate),
      eq(sajuDailyNarrative.frameHash, frameHash),
      eq(sajuDailyNarrative.modelId, modelId),
      eq(sajuDailyNarrative.promptVersion, PROMPT_VERSION),
      eq(sajuDailyNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    if (!cached.sectionsJsonb || !cached.schoolSpecificJsonb) {
      console.warn(
        "[saju/daily-narrative] cached row with null sections/schoolSpecific — falling through to regen",
        { profileId, school, forDate, promptVersion: cached.promptVersion },
      );
    } else {
      return {
        school,
        forDate,
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

  const systemPrompt = SCHOOL_PROMPTS[school];

  const baseUserContent = `${forDate} 일운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${forDate} 일운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"800~1200자 3문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별 필드...},"citations":["출처1","출처2"]}`;

  const parsed = await callDailyLlmAndParseWithRetry(
    school,
    systemPrompt,
    baseUserContent,
    modelId,
  );

  await db
    .insert(sajuDailyNarrative)
    .values({
      profileId,
      school,
      forDate,
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
        sajuDailyNarrative.profileId,
        sajuDailyNarrative.school,
        sajuDailyNarrative.forDate,
        sajuDailyNarrative.frameHash,
        sajuDailyNarrative.modelId,
        sajuDailyNarrative.promptVersion,
        sajuDailyNarrative.algorithmVersion,
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
    forDate,
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
