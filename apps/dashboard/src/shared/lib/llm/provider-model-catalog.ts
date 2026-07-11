// LLM 공급사별 모델 카탈로그 — 순수 헬퍼 (client/server 양쪽 import 안전).
//
// entities/memo/model 의 카탈로그·추천 로직을 도메인 중립으로 미러한 것.
// FSD: shared 는 entities 를 import 할 수 없어 공급사 키를 인라인 유니온으로 정의
// (precedent: reply-model-registry.ts 의 ReplyModelKey 미러).
// 프록시 fetch 가 필요한 부분은 ./provider-model-catalog-server.ts (server-only).

export const LLM_PROVIDER_KEYS = ["claude", "codex", "gemini"] as const;
export type LlmProviderKey = (typeof LLM_PROVIDER_KEYS)[number];

export type ProviderModelCatalog = Record<LlmProviderKey, string[]>;

export interface ProviderModelSelection {
  provider: LlmProviderKey;
  modelId: string;
}

export interface ProviderModelCatalogSnapshot {
  catalog: ProviderModelCatalog;
  source: "live" | "fallback";
}

export type ModelAvailability = "available" | "unavailable" | "unknown";

export interface ModelOptions {
  recommended: LlmModelRecommendation[];
  other: string[];
  availability: ModelAvailability;
}

export const LLM_PROVIDER_META: Record<
  LlmProviderKey,
  { label: string; shortLabel: string }
> = {
  claude: { label: "Anthropic (Claude)", shortLabel: "Claude" },
  codex: { label: "OpenAI (Codex/GPT)", shortLabel: "Codex" },
  gemini: { label: "Google (Gemini)", shortLabel: "Gemini" },
};

/** 프록시 모델 ID가 해당 공급사 계열인지 확인한다. */
export function isLlmModelIdForProvider(
  provider: LlmProviderKey,
  modelId: string,
): boolean {
  const id = modelId.toLowerCase();
  switch (provider) {
    case "claude":
      return id.startsWith("claude-");
    case "codex":
      return id.startsWith("gpt-") || /^o\d/.test(id) || id.includes("codex");
    case "gemini":
      return id.startsWith("gemini-");
  }
}

export interface LlmModelRecommendation {
  modelId: string;
  reason: string;
}

export interface LlmRecommendationRule {
  /** 소문자 모델 ID가 이 family에 속하는지 판정 */
  matches: (lowerId: string) => boolean;
  reason: string;
}

/**
 * 현재 카탈로그에 실제 존재하는 모델만 추천한다 (없는 모델 추천 → 저장 시
 * model-unavailable 함정 방지). 규칙 순서 = 추천 우선순위. 같은 모델이 두 규칙에
 * 걸리면 먼저 온 규칙이 가진다. 도메인별 규칙 표는 호출자가 주입한다
 * (메모/답장/사주는 같은 카탈로그라도 추천 이유가 다르다).
 */
function matchRecommendedModels(
  catalog: ProviderModelCatalog,
  provider: LlmProviderKey,
  rules: Record<LlmProviderKey, readonly LlmRecommendationRule[]>,
): LlmModelRecommendation[] {
  const ids = catalog[provider];
  const taken = new Set<string>();
  const recommendations: LlmModelRecommendation[] = [];
  for (const rule of rules[provider]) {
    const match = ids.find(
      (id) => !taken.has(id) && rule.matches(id.toLowerCase()),
    );
    if (match) {
      taken.add(match);
      recommendations.push({ modelId: match, reason: rule.reason });
    }
  }
  return recommendations;
}

export interface DeriveModelOptionsInput {
  snapshot: ProviderModelCatalogSnapshot;
  selection: ProviderModelSelection;
  recommendationRules: Record<LlmProviderKey, readonly LlmRecommendationRule[]>;
}

export function deriveModelOptions({
  snapshot,
  selection,
  recommendationRules,
}: DeriveModelOptionsInput): ModelOptions {
  const recommended = matchRecommendedModels(
    snapshot.catalog,
    selection.provider,
    recommendationRules,
  );
  const recommendedIds = new Set(recommended.map(({ modelId }) => modelId));
  const providerIds = snapshot.catalog[selection.provider];

  return {
    recommended,
    other: providerIds.filter((modelId) => !recommendedIds.has(modelId)),
    availability:
      snapshot.source === "fallback"
        ? "unknown"
        : providerIds.includes(selection.modelId)
          ? "available"
          : "unavailable",
  };
}

// URL/폼으로 들어오는 모델 ID 화이트리스트 문법 — 프록시 실제 ID 형태
// (claude-opus-4-8, gpt-5.3-codex, gemini-2.5-pro-latest 등)만 통과.
const MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/;

/** 신뢰할 수 없는 입력(searchParam/FormData)의 모델 ID 정규화. Never throws. */
export function sanitizeLlmModelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return MODEL_ID_RE.test(trimmed) ? trimmed : null;
}
