// 사주 narrative 모델 선택 메타데이터 — client/server 양쪽에서 안전하게 사용 가능 (v0.3.2).
//
// env 접근 / server-only 가 필요한 부분은 ./saju-model-registry.ts 에서 처리.
// UI(client component)는 이 파일만 import — keys, labels, parser 정도만 사용.

export const SAJU_MODEL_KEYS = ["claude", "codex", "gemini"] as const;
export type SajuModelKey = (typeof SAJU_MODEL_KEYS)[number];

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
 */
export function getModelDisplayLabel(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "Claude";
  if (id.startsWith("gpt") || id.includes("codex")) return "Codex";
  if (id.startsWith("gemini")) return "Gemini";
  return modelId;
}
