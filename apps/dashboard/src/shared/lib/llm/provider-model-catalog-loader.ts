import {
  LLM_PROVIDER_KEYS,
  isLlmModelIdForProvider,
  sanitizeLlmModelId,
  type LlmProviderKey,
  type ProviderModelCatalog,
  type ProviderModelCatalogSnapshot,
} from "./provider-model-catalog";

export interface ProviderModelCatalogPolicy {
  defaults: Record<LlmProviderKey, string>;
  defaultMode: "always" | "source-failure-only";
  allow?: Partial<Record<LlmProviderKey, (modelId: string) => boolean>>;
}

export interface ProviderModelSourceFailure {
  reason: "timeout" | "connection" | "http" | "invalid-json" | "empty";
  status?: number;
}

export type ProviderModelSource = () => Promise<readonly string[]>;
export type ProviderModelSourceFailureReporter = (
  failure: ProviderModelSourceFailure,
) => void;

export class ProviderModelSourceError extends Error {
  constructor(readonly failure: ProviderModelSourceFailure) {
    super(failure.reason);
  }
}

export function createProviderModelCatalogLoader(
  source: ProviderModelSource,
  reportFailure: ProviderModelSourceFailureReporter = () => undefined,
) {
  return async function load(
    policy: ProviderModelCatalogPolicy,
  ): Promise<ProviderModelCatalogSnapshot> {
    const defaultAllowed = validatePolicy(policy);

    let sourceIds: readonly string[];
    try {
      sourceIds = await source();
    } catch (error) {
      const failure =
        error instanceof ProviderModelSourceError
          ? error.failure
          : ({ reason: "connection" } as const);
      reportFailure(failure);
      return buildFallbackSnapshot(policy, defaultAllowed);
    }

    const ids = sourceIds
      .map((id) => sanitizeLlmModelId(id))
      .filter((id): id is string => id !== null)
      .filter((id) =>
        LLM_PROVIDER_KEYS.some((provider) =>
          isLlmModelIdForProvider(provider, id),
        ),
      );

    if (ids.length === 0) {
      reportFailure({ reason: "empty" });
      return buildFallbackSnapshot(policy, defaultAllowed);
    }

    return {
      source: "live",
      catalog: buildLiveCatalog(ids, policy),
    };
  };
}

function validatePolicy(
  policy: ProviderModelCatalogPolicy,
): Record<LlmProviderKey, boolean> {
  if (
    policy.defaultMode !== "always" &&
    policy.defaultMode !== "source-failure-only"
  ) {
    throw new Error(`Unsupported defaultMode: ${String(policy.defaultMode)}`);
  }

  const allowed: Record<LlmProviderKey, boolean> = {
    claude: true,
    codex: true,
    gemini: true,
  };
  for (const provider of LLM_PROVIDER_KEYS) {
    const modelId = policy.defaults[provider];
    if (
      sanitizeLlmModelId(modelId) !== modelId ||
      !isLlmModelIdForProvider(provider, modelId)
    ) {
      throw new Error(`Invalid ${provider} default model: ${String(modelId)}`);
    }
    allowed[provider] = policy.allow?.[provider]?.(modelId) ?? true;
    if (policy.defaultMode === "always" && !allowed[provider]) {
      throw new Error(`${provider} default model is rejected by allow policy`);
    }
  }
  return allowed;
}

function buildFallbackSnapshot(
  policy: ProviderModelCatalogPolicy,
  defaultAllowed: Record<LlmProviderKey, boolean>,
): ProviderModelCatalogSnapshot {
  return {
    source: "fallback",
    catalog: Object.fromEntries(
      LLM_PROVIDER_KEYS.map((provider) => [
        provider,
        defaultAllowed[provider] ? [policy.defaults[provider]] : [],
      ]),
    ) as ProviderModelCatalog,
  };
}

function buildLiveCatalog(
  ids: readonly string[],
  policy: ProviderModelCatalogPolicy,
): ProviderModelCatalog {
  const catalog: ProviderModelCatalog = { claude: [], codex: [], gemini: [] };

  for (const provider of LLM_PROVIDER_KEYS) {
    const defaultModel = policy.defaults[provider];
    const allow = policy.allow?.[provider];
    const remote = ids
      .filter((id) => isLlmModelIdForProvider(provider, id))
      .filter((id) => allow?.(id) ?? true);
    const candidates = [
      ...(policy.defaultMode === "always" ? [defaultModel] : []),
      ...remote,
    ];

    catalog[provider] = candidates
      .filter((id, index, all) => all.indexOf(id) === index)
      .sort((a, b) => {
        if (a === defaultModel) return -1;
        if (b === defaultModel) return 1;
        return b.localeCompare(a, undefined, { numeric: true });
      });
  }

  return catalog;
}
