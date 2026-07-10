// cli-proxy-api /v1/models → 공급사별 카탈로그 (server-only).
// features/memo-transform/lib/model-catalog.ts 의 도메인 중립판.
// 차이: fallback(각 도메인이 실제 기본으로 쓰는 모델 ID)은 프록시 목록 유무와
// 무관하게 항상 포함한다 — 프록시 라우팅은 ID prefix 기반이라 목록에서 잠시
// 빠져도 호출은 유효하고, 기본값이 "(사용 불가)"로 표시되는 혼란을 막는다.
import "server-only";
import { env } from "@/shared/config/env";
import {
  LLM_PROVIDER_KEYS,
  isLlmModelIdForProvider,
  type LlmProviderKey,
  type ProviderModelCatalog,
} from "./provider-model-catalog";

interface ModelsResponse {
  data?: Array<{ id?: unknown }>;
}

export function buildProviderModelCatalog(
  ids: readonly string[],
  fallbackIds: Record<LlmProviderKey, string>,
): ProviderModelCatalog {
  const catalog: ProviderModelCatalog = { claude: [], codex: [], gemini: [] };

  for (const provider of LLM_PROVIDER_KEYS) {
    const fallback = fallbackIds[provider];
    const matches = ids.filter((id) => isLlmModelIdForProvider(provider, id));
    catalog[provider] = [fallback, ...matches]
      .filter((id, index, all) => all.indexOf(id) === index)
      .sort((a, b) => {
        if (a === fallback) return -1;
        if (b === fallback) return 1;
        return b.localeCompare(a, undefined, { numeric: true });
      });
  }

  return catalog;
}

async function fetchProxyModelIds(): Promise<string[] | null> {
  try {
    const response = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/models`, {
      headers: { "x-api-key": env.ANTHROPIC_API_KEY },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as ModelsResponse;
    return (body.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return null;
  }
}

/** 프록시의 현재 /v1/models를 공급사별로 분류한다. 실패 시 fallback 기본 모델만 노출한다. */
export async function listProviderModelCatalog(
  fallbackIds: Record<LlmProviderKey, string>,
): Promise<ProviderModelCatalog> {
  const ids = (await fetchProxyModelIds()) ?? [];
  return buildProviderModelCatalog(ids, fallbackIds);
}
