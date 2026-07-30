// 사주 narrative 모델 선택 메타데이터 — client/server 양쪽에서 안전하게 사용 가능 (v0.3.2).
//
// env 접근 / server-only 가 필요한 부분은 ./saju-model-registry.ts 에서 처리.
// UI(client component)는 이 파일만 import — keys, labels, parser 정도만 사용.
import type {
  LlmProviderKey,
  LlmRecommendationRule,
} from "./provider-model-catalog";

// 표시 순서는 사주 도메인이 소유한다 — 공통 LLM_PROVIDER_KEYS 선언 순서와 무관.
export const SAJU_MODEL_KEYS = ["claude", "codex", "gemini"] as const;
export type SajuModelKey = LlmProviderKey;

export interface SajuModelMeta {
  label: string;
  vendor: string;
  description: string;
}

export const SAJU_MODEL_META: Record<SajuModelKey, SajuModelMeta> = {
  claude: {
    label: "Claude Opus 4.7",
    vendor: "Anthropic",
    description: "Anthropic Claude Opus 4.7 — 기본 모델, narrative schema 준수도 높음",
  },
  codex: {
    label: "Codex (GPT-5)",
    vendor: "OpenAI",
    description: "OpenAI Codex (GPT-5 기반) — 비교 분석용 대안 모델",
  },
  gemini: {
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    description: "Google Gemini 2.5 Pro — 비교 분석용 대안 모델",
  },
};

// 상세 모델 추천 규칙 (memo model-recommendations 패턴 — 규칙 순서 = 추천 우선순위).
// 프록시 /v1/models 목록은 수시로 바뀌므로 ID 하드코딩 대신 family 패턴으로 매칭.
export const SAJU_MODEL_RECOMMENDATION_RULES: Record<
  SajuModelKey,
  LlmRecommendationRule[]
> = {
  claude: [
    {
      matches: (id) => id.includes("opus"),
      reason: "narrative 스키마 준수도 최고 — 기본 추천",
    },
    {
      matches: (id) => id.includes("sonnet"),
      reason: "품질·속도 균형",
    },
  ],
  codex: [
    {
      // image 모델은 narrative 생성에 부적합 — 프록시 목록에 섞여 있어 명시 제외
      matches: (id) =>
        id.startsWith("gpt-") &&
        !id.includes("oss") &&
        !id.includes("codex") &&
        !id.includes("image"),
      reason: "범용 고품질 — 비교 분석용",
    },
    {
      matches: (id) => id.includes("codex"),
      reason: "구조화 출력 특화",
    },
  ],
  gemini: [
    {
      matches: (id) => id.includes("pro"),
      reason: "긴 문맥·자연스러운 서사 — 기본 추천",
    },
    {
      matches: (id) => id.includes("flash"),
      reason: "가장 빠르고 경제적",
    },
  ],
};

export const DEFAULT_SAJU_MODEL_KEY: SajuModelKey = "claude";

/**
 * URL search param 으로 들어온 raw 값을 안전하게 SajuModelKey 로 정규화.
 * Never throws — 잘못된 입력은 DEFAULT_SAJU_MODEL_KEY 로 폴백.
 */
export function parseSajuModelKey(raw: unknown): SajuModelKey {
  if (typeof raw !== "string") return DEFAULT_SAJU_MODEL_KEY;
  return (SAJU_MODEL_KEYS as readonly string[]).includes(raw)
    ? (raw as SajuModelKey)
    : DEFAULT_SAJU_MODEL_KEY;
}

/**
 * DB 캐시 row 의 modelId 문자열로부터 사용자에게 보일 라벨을 추론.
 * env 가 갱신돼 옛 row 의 modelId 가 현재 env 값과 다를 수 있으므로
 * vendor prefix 기반 휴리스틱 사용 — picker registry 와는 독립.
 * 알 수 없는 값은 modelId 원문을 그대로 반환 (디버깅 친화).
 *
 * deriveLlmProviderFromModelId 로 위임하지 않는다 — 그쪽은 하이픈까지 요구해
 * (`claude-`) 더 좁고, 여기 들어오는 값은 이미 죽은 env 의 옛 row 라 형태를
 * 보장할 수 없다. 라벨은 표시일 뿐 라우팅 결정이 아니므로 관용적인 쪽을 택한다.
 */
export function getModelDisplayLabel(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "Claude";
  if (id.startsWith("gpt") || id.includes("codex")) return "Codex";
  if (id.startsWith("gemini")) return "Gemini";
  return modelId;
}
