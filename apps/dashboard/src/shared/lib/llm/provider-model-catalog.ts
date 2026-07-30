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

/**
 * 프록시 모델 ID가 해당 공급사 계열인지 확인한다.
 *
 * **세 술어는 상호 배타여야 한다** — 전부 접두사 판정인 이유다. 하나라도 부분
 * 문자열 판정이면 한 모델이 두 공급사에 걸리고, 그때 공급사 도출은 선언 순서에
 * 좌우된다 (`includes("codex")` 시절 "gemini-codex-x" 가 codex 로 렌더된 것이
 * 사주 모델 선택 버그 3회 재발의 뿌리). 배타성은 provider-model-catalog.test.ts
 * 가 property 로 고정한다.
 *
 * codex 는 접두사가 셋 (`gpt-` · `o<digit>` · `codex`) — 프록시가 세 형태를 모두
 * 노출한다 (gpt-5.5, o3-mini, codex-auto-review). 실측(2026-07-30, 모델 57개)상
 * `codex` 를 포함하면서 이 셋 중 어느 접두사도 아닌 ID 는 없다.
 */
export function isLlmModelIdForProvider(
  provider: LlmProviderKey,
  modelId: string,
): boolean {
  const id = modelId.toLowerCase();
  switch (provider) {
    case "claude":
      return id.startsWith("claude-");
    case "codex":
      return id.startsWith("gpt-") || /^o\d/.test(id) || id.startsWith("codex");
    case "gemini":
      return id.startsWith("gemini-");
  }
}

/**
 * 모델 ID 하나에서 공급사를 도출한다. `find` 로 첫 매칭을 취해도 안전한 근거는
 * `isLlmModelIdForProvider` 의 배타성이다 — 매칭은 0개 아니면 1개다.
 *
 * 지원 공급사 계열이 아니면 null. 프록시는 grok-* 처럼 대시보드가 다루지 않는
 * 계열도 노출하므로 이 null 은 정상 경로이며, 호출자가 각자의 정책으로 처리한다.
 */
export function deriveLlmProviderFromModelId(
  modelId: string,
): LlmProviderKey | null {
  return (
    LLM_PROVIDER_KEYS.find((provider) =>
      isLlmModelIdForProvider(provider, modelId),
    ) ?? null
  );
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
