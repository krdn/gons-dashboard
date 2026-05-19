// Saju 삼국 분석 v0.3.1 — LLM yearly narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (lifetime narrative-server.ts 미러링):
//  - 캐시 키: (profile_id, school, target_year, frame_hash, model_id,
//             prompt_version, algorithm_version)
//  - frame_hash: YearlyFrame JSON.stringify 의 sha256 (학파 + 연도별 독립)
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패 모두 throw → route 에서 500 + console.error
//  - 동시 cache miss / null schoolSpecific 자가 치유: onConflictDoUpdate
//
// v0.3 와의 차이:
//  - prompts.ts 분리 (PROMPT_VERSION=2 + 학파별 BODY 30~50줄)
//  - schemas.ts 분리 (학파별 schoolSpecific union)
//  - sections 에 keyTerms + cautions 추가
//  - sajuYearlyNarrative 컬럼에 prompt_version + school_specific_jsonb 추가
//  - MAX_NARRATIVE_TOKENS 4096 → 6144 (1200~1600자 본문)
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, type YearlyFrame } from "@gons/saju";
import { env } from "@/shared/config/env";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuYearlyNarrative,
  type YearlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  PROMPT_VERSION,
  SCHOOL_PROMPTS,
  type NarrativeSchool,
} from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";

// Opus 4.x — temperature 매개변수 미지정 (proxy 가 400 반환).
const MODEL_ID = env.SAJU_LLM_MODEL;
const MAX_NARRATIVE_TOKENS = 6144;

export type { NarrativeSchool } from "./prompts";

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

export async function getOrBuildYearlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  frame: YearlyFrame,
): Promise<YearlyNarrativeResult> {
  // frame_hash — YearlyFrame 의 JSON 직렬화 후 sha256.
  //  - builder 가 고정 키 순서로 생성하므로 JSON.stringify 결정형.
  //  - frame 구조 변경 시 자동으로 모든 캐시가 무효화된다.
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회 — promptVersion 필터로 v1 row 제외.
  const cached = await db.query.sajuYearlyNarrative.findFirst({
    where: and(
      eq(sajuYearlyNarrative.profileId, profileId),
      eq(sajuYearlyNarrative.school, school),
      eq(sajuYearlyNarrative.targetYear, targetYear),
      eq(sajuYearlyNarrative.frameHash, frameHash),
      eq(sajuYearlyNarrative.modelId, MODEL_ID),
      eq(sajuYearlyNarrative.promptVersion, PROMPT_VERSION),
      eq(sajuYearlyNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    if (!cached.schoolSpecificJsonb) {
      // 이론상 도달 불가 (PROMPT_VERSION=2 필터로 v1 row 제외).
      // 방어용 로그 + miss 처리 fall-through. lifetime 와 동일 패턴.
      console.warn(
        "[saju/yearly-narrative] v2 row with null schoolSpecific — falling through to regen",
        {
          profileId,
          school,
          targetYear,
          promptVersion: cached.promptVersion,
        },
      );
    } else {
      return {
        school,
        targetYear,
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

  // 2) miss → LLM 호출
  //
  // cli-proxy-api 경유 시 system prompt 의 JSON 강제 지시가 무효화되는 이슈가
  // 2026-05-18 운영에서 관측됨 (lifetime v0.2 와 동일 전략). 회피: 동일 JSON
  // 스키마 지시를 user message 본문 자체에 박는다.
  const systemPrompt = SCHOOL_PROMPTS[school];

  const userContent = `${targetYear}년 세운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 세운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"1200~1600자 4~5문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별 필드...},"citations":["출처1","출처2"]}`;

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
  // SCHOOL_SCHEMAS 는 Record<NarrativeSchool, z.ZodType> 로 typing 되어 있어
  // .parse() 반환이 unknown. 학파별 스키마 출력은 모두 NarrativeOutput 의 structural
  // superset (schemas.ts 의 satisfies z.ZodType<...> 가 보장) 이므로 cast 안전.
  const parsed = SCHOOL_SCHEMAS[school].parse(json) as NarrativeOutput;

  // 3) 캐시 저장 — onConflictDoUpdate 로 변경 (이전: onConflictDoNothing).
  //    이유: v2 row 가 null schoolSpecificJsonb 로 들어간 경우(이론상 도달 불가하나
  //    DB nullable) 다음 cache miss 시 LLM 재호출 후 update 가 컬럼을 채워 자가 치유.
  //    정상 동시 cache miss 에서는 same payload 로 update 되므로 무해.
  await db
    .insert(sajuYearlyNarrative)
    .values({
      profileId,
      school,
      targetYear,
      frameHash,
      modelId: MODEL_ID,
      promptVersion: PROMPT_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      narrativeText: parsed.narrativeText,
      sectionsJsonb: parsed.sections,
      schoolSpecificJsonb: parsed.schoolSpecific,
      citations: parsed.citations,
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
    narrativeText: parsed.narrativeText,
    sections: parsed.sections,
    schoolSpecific: parsed.schoolSpecific,
    citations: parsed.citations,
    modelId: MODEL_ID,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
