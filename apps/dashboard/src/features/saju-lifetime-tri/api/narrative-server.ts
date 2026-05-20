// Saju 삼국 분석 v0.2 — LLM narrative 빌더/캐시 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school, frame_hash, model_id, prompt_version)
//  - frame_hash: LifetimeFrame JSON.stringify 의 sha256 (학파별로 독립)
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패 모두 throw → route 에서 500 + console.error
//  - 동시 cache miss / null schoolSpecific 자가 치유: onConflictDoUpdate
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { ALGORITHM_VERSION, type LifetimeFrame } from "@gons/saju";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuLifetimeNarrative,
  type LifetimeNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  PROMPT_VERSION,
  SCHOOL_PROMPTS,
  type NarrativeSchool,
} from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";

// Opus 4.x — temperature 매개변수 미지정 (proxy 가 400 반환).
// 모델 ID 는 호출자(API route)가 명시 전달 — v0.3.2: 사용자가 선택한 모델 (Claude/Codex/Gemini).
// 캐시 키의 model_id 컬럼이 모델별 자연 분리 키 — 모델 변경 시 자동 무효화.
const MAX_NARRATIVE_TOKENS = 8192; // 4096 → 8192 (v0.2 1500~2000자 분량)

export type { NarrativeSchool } from "./prompts";

// LLM 응답이 prose/마크다운으로 시작/종료해도 JSON 본문을 추출한다.
// system prompt 가 "JSON 만" 지시해도 cli-proxy-api 경유 시 마크다운 헤더, 한국어
// 접두사("명조 분석 요약 ..."), ```json 펜스 등의 변형이 운영에서 관측됐다.
// 전략: 첫 '{' 부터 균형 잡힌 '}' 까지를 brace counter 로 추출. 문자열 리터럴 안의
// 중괄호와 escape 를 인식해 오추출 방지.
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

// Hotfix #3: LLM 호출 + JSON.parse + zod.parse 를 한 단위로 wrap. ZodError 발생 시
// 1회만 재시도 — 두 번째 시도에서 user content 끝에 직전 fail 한 필드/분량 reminder 첨부.
// JSON.parse 실패는 재시도 안 함 (마크다운/prose 일관성 문제라 같은 prompt 로 더 시도해도 무의미).
async function callLlmAndParseWithRetry(
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
        `[saju-lifetime-narrative] LLM_CALL_FAIL model=${modelId} school=${school} attempt=${attempt}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const firstBlock = response.content[0];
    const text =
      firstBlock && firstBlock.type === "text" ? firstBlock.text : "";
    const stopReason = response.stop_reason;

    try {
      const json = JSON.parse(extractJsonObject(text));
      return SCHOOL_SCHEMAS[school].parse(json) as NarrativeOutput;
    } catch (err) {
      lastErr = err;
      if (err instanceof ZodError) {
        console.error(
          `[saju-lifetime-narrative] ZOD_FAIL model=${modelId} school=${school} attempt=${attempt} stop=${stopReason} text_len=${text.length}: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
        if (attempt === 2) throw err;
      } else {
        // JSON.parse / extractJsonObject 실패 — prose 응답.
        console.error(
          `[saju-lifetime-narrative] JSON_PARSE_FAIL model=${modelId} school=${school} attempt=${attempt} stop=${stopReason} text_len=${text.length} text_head=${JSON.stringify(text.slice(0, 200))}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }
  }
  // 도달 불가 (loop 안에서 return 또는 throw).
  throw lastErr ?? new Error("LLM retry loop exited without result");
}

export async function getOrBuildNarrative(
  profileId: string,
  school: NarrativeSchool,
  frame: LifetimeFrame,
  modelId: string,
): Promise<NarrativeResult> {
  // frame_hash — LifetimeFrame 의 JSON 직렬화 후 sha256.
  //  - 학파별 LifetimeFrame 은 builder 가 고정 키 순서로 생성하므로 JSON.stringify 결정형.
  //  - frame 구조 변경 시 자동으로 모든 캐시가 무효화된다.
  //  - 향후 builder 가 비결정적 값(Map/Set/Date 등)을 주입하면 lifetime-server.ts 의
  //    inputHash 처럼 명시 정규화 (join("|")) 가 필요해진다.
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회
  const cached = await db.query.sajuLifetimeNarrative.findFirst({
    where: and(
      eq(sajuLifetimeNarrative.profileId, profileId),
      eq(sajuLifetimeNarrative.school, school),
      eq(sajuLifetimeNarrative.frameHash, frameHash),
      eq(sajuLifetimeNarrative.modelId, modelId),
      eq(sajuLifetimeNarrative.promptVersion, PROMPT_VERSION),
      eq(sajuLifetimeNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    if (!cached.schoolSpecificJsonb) {
      // 이론상 도달 불가 (PROMPT_VERSION=2 필터로 v1 row 제외).
      // 방어용 로그 + miss 처리 fall-through.
      console.warn(
        "[saju/narrative] v2 row with null schoolSpecific — falling through to regen",
        { profileId, school, promptVersion: cached.promptVersion },
      );
    } else {
      return {
        school,
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
  // 2026-05-18 운영에서 관측됨 (응답이 마크다운 prose 로 옴 — `## 명조 분석`).
  // 회피: 동일 JSON 스키마 지시를 user message 본문 자체에 박는다.
  //
  // Hotfix #3 (v0.3.1.1): zod ZodError 발생 시 1회 재시도 — 두 번째 시도에서 더 강한
  // 분량/필드 reminder 첨부. LLM 출력 variance 가 큰 cli-proxy 경유 환경 대응.
  const systemPrompt = SCHOOL_PROMPTS[school];

  const baseUserContent = `명조 분석:\n${JSON.stringify(frame, null, 2)}

위 명조를 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"1500~2000자 5문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별...},"citations":["출처1","출처2"]}`;

  const parsed = await callLlmAndParseWithRetry(school, systemPrompt, baseUserContent, modelId);

  // 3) 캐시 저장 — onConflictDoUpdate 로 변경 (이전: onConflictDoNothing).
  //    이유: v2 row 가 null schoolSpecificJsonb 로 들어간 경우(이론상 도달 불가하나 DB nullable)
  //    다음 cache miss 시 LLM 재호출 후 update 가 컬럼을 채워 자가 치유.
  //    정상 동시 cache miss 에서는 same payload 로 update 되므로 무해.
  //    target: uniqueIndex (profileId, school, frameHash, modelId, promptVersion).
  await db
    .insert(sajuLifetimeNarrative)
    .values({
      profileId,
      school,
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
        sajuLifetimeNarrative.profileId,
        sajuLifetimeNarrative.school,
        sajuLifetimeNarrative.frameHash,
        sajuLifetimeNarrative.modelId,
        sajuLifetimeNarrative.promptVersion,
        sajuLifetimeNarrative.algorithmVersion,
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
