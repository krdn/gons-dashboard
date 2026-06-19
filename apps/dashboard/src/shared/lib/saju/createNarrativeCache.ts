// Saju 삼국 narrative cache-or-generate 팩토리 — lifetime/yearly/monthly/daily 4개
// narrative-server 가 공유하는 정책 시퀀스 (frameHash → cache 조회 → null 자가치유 →
// budget guard → LLM + ZodError 재시도 → spend log) 를 단일 factory 로 묶는다.
//
// 설계: createSajuTriCache (frame 캐시) 를 정확히 미러 — DB I/O 를 findCached/insertCache
// 콜백으로 caller 에 위임하고, factory 는 정책 시퀀스만 소유한다. DB-shape 변이(테이블·추가
// 키 컬럼·result envelope 추가 필드)가 WHERE·INSERT·conflict target·envelope 4곳에 흐르므로
// declarative table 슬롯으로는 컴포즈 불가 — 콜백 위임이 유일하게 깨끗.
//
// Design spec: docs/superpowers/specs/2026-06-19-saju-narrative-cache-deepening.md
import "server-only";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { analyzeStructured, normalizeUsage } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults } from "@/shared/lib/llm/anthropic";
import { computeKrw } from "@/shared/lib/llm/pricing";

export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

// 4개 narrative output 이 공유하는 공통 모양. sections 타입만 timeframe 별로 다르다.
export interface NarrativeOutputShape<Sections> {
  narrativeText: string;
  sections: Sections;
  schoolSpecific: unknown;
  citations: string[];
}

// cache row 의 공통 읽기 모양. caller 의 findCached 가 이 모양으로 정규화해 반환.
export interface CachedNarrativeRow<Sections> {
  narrativeText: string;
  sectionsJsonb: Sections | null;
  schoolSpecificJsonb: unknown | null;
  citations: string[];
  modelId: string;
  promptVersion: number;
  algorithmVersion: number;
  generatedAt: Date;
}

// caller 의 insertCache 가 받는 payload (validated LLM output + 메타 + 호출 컨텍스트).
export interface NarrativeRowToWrite<Frame, Extra, Sections> {
  ctx: NarrativeCallContext<Frame, Extra>;
  narrativeText: string;
  sections: Sections;
  schoolSpecific: unknown;
  citations: string[];
}

// 매 호출 시 factory 가 콜백에 넘기는 컨텍스트. createSajuTriCache 의 (profileId,
// params) 인자 전달 패턴 미러 — 추가 키(year/month/forDate)는 extra 에 실리고,
// caller 가 모듈 레벨에서 한 번 만든 config 의 콜백이 ctx.extra 에서 꺼낸다.
// lifetime 처럼 추가 키가 없으면 Extra = Record<string, never>.
export interface NarrativeCallContext<Frame, Extra> {
  profileId: string;
  school: NarrativeSchool;
  frame: Frame;
  frameHash: string;
  modelId: string;
  promptVersion: number;
  algorithmVersion: number;
  extra: Extra;
}

export interface NarrativeCacheConfig<Frame, Extra, Sections, Result> {
  // 운영 로그 grep 패턴 보존용 태그 (예: "saju-lifetime-narrative").
  logTag: string;
  // LLM 응답 검증 스키마 (학파별). input 측은 unknown — ZodDefault 등으로 output 과
  // 다를 수 있어 analyzeStructured 의 ZodType<T, _, unknown> 시그니처에 맞춘다.
  schema: Record<NarrativeSchool, ZodType<NarrativeOutputShape<Sections>, ZodTypeDef, unknown>>;
  // 분량별 토큰 상한.
  maxTokens: number;
  // 예산 가드 + spend 로깅 — features/saju-reading 의 budget 모듈을 caller 가 주입한다
  // (shared → features 역의존 회피. FSD 순수성). factory 는 "언제 호출하는지"만 소유.
  assertBudget: () => Promise<void>;
  logSpend: (input: { model: string; inputTokens: number; outputTokens: number; krw: number }) => Promise<void>;
  // prompt 텍스트 전체(분량 문구·JSON 스키마 예시·schoolSpecific 예시)를 caller 가 조립.
  // ctx 전체를 받으므로 frame·school·extra(targetYear/targetMonth/forDate) 모두 접근 가능 —
  // 원본 prompt 의 "${targetYear}년 세운 분석" 같은 extra 참조를 재현한다.
  buildUserContent: (ctx: NarrativeCallContext<Frame, Extra>) => string;
  buildSystemPrompt: (school: NarrativeSchool) => string;
  // cache 조회 — caller 가 ctx.extra 에서 추가 키(year/month/forDate)를 꺼내 WHERE 에 박는다.
  findCached: (ctx: NarrativeCallContext<Frame, Extra>) => Promise<CachedNarrativeRow<Sections> | undefined>;
  // cache 저장 — INSERT values + onConflictDoUpdate target 전부 caller (ctx.extra 의 추가 키 포함).
  insertCache: (row: NarrativeRowToWrite<Frame, Extra, Sections>) => Promise<void>;
  // result envelope 조립 — caller 가 ctx.extra 에서 forDate/targetYear 등 필드를 얹는다.
  toResult: (
    payload: NarrativeOutputShape<Sections>,
    meta: {
      ctx: NarrativeCallContext<Frame, Extra>;
      modelId: string;
      promptVersion: number;
      algorithmVersion: number;
      generatedAt: string;
      fromCache: boolean;
    },
  ) => Result;
}

/**
 * narrative cache-or-generate 팩토리. 모듈 레벨에서 1회 생성하고, 반환 함수를 매 호출.
 *
 * 반환 함수 시그니처: (ctx: NarrativeCallContext) → Result. 추가 키(year/month/forDate)는
 * caller 가 ctx.frame 또는 ctx 에 실어 보내고, findCached/insertCache/toResult 가 ctx 에서
 * 꺼내 쓴다 (createSajuTriCache 의 params 전달 패턴 미러).
 */
export function createNarrativeCache<Frame, Extra, Sections, Result>(
  config: NarrativeCacheConfig<Frame, Extra, Sections, Result>,
) {
  return async function getOrBuild(ctx: NarrativeCallContext<Frame, Extra>): Promise<Result> {
    const { profileId, school, modelId, promptVersion, algorithmVersion } = ctx;

    // 1) 캐시 조회
    const cached = await config.findCached(ctx);
    if (cached) {
      // null 자가치유 가드 — sections·schoolSpecific 둘 다 검사 (4개 통일).
      // 이론상 도달 불가 (promptVersion 필터로 옛 row 제외) 하나 DB nullable 방어 + 자가치유.
      if (!cached.sectionsJsonb || !cached.schoolSpecificJsonb) {
        console.warn(
          `[${config.logTag}] cached row with null sections/schoolSpecific — falling through to regen`,
          { profileId, school, promptVersion: cached.promptVersion },
        );
      } else {
        return config.toResult(
          {
            narrativeText: cached.narrativeText,
            sections: cached.sectionsJsonb,
            schoolSpecific: cached.schoolSpecificJsonb,
            citations: cached.citations,
          },
          {
            ctx,
            modelId: cached.modelId,
            promptVersion: cached.promptVersion,
            algorithmVersion: cached.algorithmVersion,
            generatedAt: cached.generatedAt.toISOString(),
            fromCache: true,
          },
        );
      }
    }

    // 2) 예산 가드 (cache miss 확정 후, LLM 호출 전, build 당 1회)
    await config.assertBudget();

    // 3) miss → LLM 호출 (ZodError 1회 재시도)
    const systemPrompt = config.buildSystemPrompt(school);
    const baseUserContent = config.buildUserContent(ctx);
    const { output, inputTokens, outputTokens } = await callLlmWithRetry(
      config,
      school,
      systemPrompt,
      baseUserContent,
      modelId,
    );

    // 4) spend 기록 (validate 성공 후에만 — "validated outputs only")
    await config.logSpend({
      model: modelId,
      inputTokens,
      outputTokens,
      krw: computeKrw(modelId, inputTokens, outputTokens),
    });

    // 5) 캐시 저장 (idempotent upsert — caller 가 ctx 의 추가 키 + conflict target 담당)
    await config.insertCache({
      ctx,
      narrativeText: output.narrativeText,
      sections: output.sections,
      schoolSpecific: output.schoolSpecific,
      citations: output.citations,
    });

    return config.toResult(output, {
      ctx,
      modelId,
      promptVersion,
      algorithmVersion,
      generatedAt: new Date().toISOString(),
      fromCache: false,
    });
  };
}

// LLM 호출 + JSON.parse + zod.parse 를 한 단위로 wrap. ZodError 발생 시 1회만 재시도 —
// 두 번째 시도에서 user content 끝에 직전 fail 한 필드/분량 reminder 첨부. JSON.parse/LLM
// 실패는 재시도 안 함 (같은 prompt 로 더 시도해도 무의미).
async function callLlmWithRetry<Sections>(
  config: Pick<NarrativeCacheConfig<unknown, unknown, Sections, unknown>, "schema" | "maxTokens" | "logTag">,
  school: NarrativeSchool,
  systemPrompt: string,
  baseUserContent: string,
  modelId: string,
): Promise<{ output: NarrativeOutputShape<Sections>; inputTokens: number; outputTokens: number }> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userContent =
      attempt === 1
        ? baseUserContent
        : `${baseUserContent}\n\n[중요 — 재시도] 이전 응답이 schema 검증에 실패했습니다. 모든 sections 필드를 충분한 분량으로 채우고, schoolSpecific 의 모든 필드를 빠짐없이 작성하세요. 출력은 JSON 본문만.\n\n검증 실패 상세: ${lastErr instanceof ZodError ? lastErr.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(lastErr)}`;

    try {
      const { object, usage } = await analyzeStructured(userContent, config.schema[school], {
        ...gatewayDefaults,
        model: modelId,
        systemPrompt,
        maxOutputTokens: config.maxTokens,
      });
      const { inputTokens, outputTokens } = normalizeUsage(usage);
      return { output: object as NarrativeOutputShape<Sections>, inputTokens, outputTokens };
    } catch (err) {
      lastErr = err;
      if (err instanceof ZodError) {
        console.error(
          `[${config.logTag}] ZOD_FAIL model=${modelId} school=${school} attempt=${attempt}: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
        if (attempt === 2) throw err;
      } else {
        console.error(
          `[${config.logTag}] LLM_FAIL model=${modelId} school=${school} attempt=${attempt}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }
  }
  throw lastErr ?? new Error("LLM retry loop exited without result");
}
