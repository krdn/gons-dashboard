// 페르소나별 모델 override — 공급사 키 + 프록시 상세 모델 ID 페어 (순수, client/server 양쪽 안전).
//
// stock_persona_preferences.overrides jsonb 의 value 형태:
//   legacy: "claude" (공급사 키만 — modelId 는 런타임 최신 자동)
//   현재:   { model: "codex", modelId: "gpt-5.5" } (modelId 생략 시 자동)
// jsonb 라 DDL 없이 확장 — legacy string 은 읽기 시 normalizePersonaOverride 로 수용.
import type { ModelName } from "./persona-types";
import type {
  LlmRecommendationRule,
  ProviderModelCatalogSnapshot,
} from "@/shared/lib/llm/provider-model-catalog";

export interface PersonaModelOverride {
  model: ModelName;
  /** 프록시 상세 모델 ID. 없으면 공급사 tier 최신을 런타임 자동 선택. */
  modelId?: string;
}

const MODEL_NAMES: readonly string[] = ["claude", "codex", "gemini"];

/** DB jsonb value(legacy string | 객체)를 override 객체로 정규화. 잘못된 값은 null. */
export function normalizePersonaOverride(
  raw: unknown,
): PersonaModelOverride | null {
  if (typeof raw === "string") {
    return MODEL_NAMES.includes(raw) ? { model: raw as ModelName } : null;
  }
  if (typeof raw === "object" && raw !== null && "model" in raw) {
    const { model, modelId } = raw as { model?: unknown; modelId?: unknown };
    if (typeof model !== "string" || !MODEL_NAMES.includes(model)) return null;
    return typeof modelId === "string" && modelId.length > 0
      ? { model: model as ModelName, modelId }
      : { model: model as ModelName };
  }
  return null;
}

// 설정 다이얼로그가 lazy 로드하는 카탈로그 응답 형태 (personaModelCatalogAction).
// "use server" 파일에서 타입을 정의/재-export하지 않는다 — dev 모듈 사망 전례
// (use-server-type-reexport-referenceerror) 회피를 위해 순수 모듈인 여기에 둔다.
export interface PersonaModelCatalogData {
  snapshot: ProviderModelCatalogSnapshot;
  // 각 공급사의 서버 기본 모델 ID (resolveLatestModel 결과) — modelId 미지정 표시용.
  defaults: Record<ModelName, string>;
}

// 상세 모델 추천 규칙 (memo/reply/saju 와 같은 형식 — 규칙 순서 = 추천 우선순위).
// 프록시 /v1/models 목록은 수시로 바뀌므로 ID 하드코딩 대신 family 패턴으로 매칭.
export const STOCK_MODEL_RECOMMENDATION_RULES: Record<
  ModelName,
  LlmRecommendationRule[]
> = {
  claude: [
    {
      matches: (id) => id.includes("opus"),
      reason: "깊은 추론 — 페르소나 분석 기본 추천",
    },
    {
      matches: (id) => id.includes("sonnet"),
      reason: "품질·속도 균형",
    },
  ],
  codex: [
    {
      // image 모델은 구조화 분석에 부적합 — 프록시 목록에 섞여 있어 명시 제외
      matches: (id) =>
        id.startsWith("gpt-") &&
        !id.includes("oss") &&
        !id.includes("codex") &&
        !id.includes("image"),
      reason: "범용 고품질 — 기본 추천",
    },
    {
      matches: (id) => id.includes("codex"),
      reason: "구조화 출력 특화",
    },
  ],
  gemini: [
    {
      matches: (id) => id.includes("pro"),
      reason: "긴 문맥·시장 서사 — 기본 추천",
    },
    {
      matches: (id) => id.includes("flash"),
      reason: "가장 빠르고 경제적",
    },
  ],
};
