import "server-only";
import { env } from "@/shared/config/env";
import {
  MEMO_MODEL_KEYS,
  isMemoModelIdForProvider,
  type MemoModelCatalog,
} from "@/entities/memo/server";
import { resolveMemoModelId } from "./model-registry";

interface ModelsResponse {
  data?: Array<{ id?: unknown }>;
}

export function buildMemoModelCatalog(
  ids: readonly string[],
  includeFallback = true,
): MemoModelCatalog {
  const catalog: MemoModelCatalog = { claude: [], codex: [], gemini: [] };

  for (const provider of MEMO_MODEL_KEYS) {
    const fallback = resolveMemoModelId(provider);
    const matches = ids.filter((id) => isMemoModelIdForProvider(provider, id));
    catalog[provider] = [...(includeFallback ? [fallback] : []), ...matches]
      .filter((id, index, all) => all.indexOf(id) === index)
      .sort((a, b) => {
        if (a === fallback) return -1;
        if (b === fallback) return 1;
        return b.localeCompare(a, undefined, { numeric: true });
      });
  }

  return catalog;
}

async function fetchMemoProxyModelIds(): Promise<string[] | null> {
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

/** cli-proxy-api의 현재 /v1/models를 공급사별로 분류한다. 실패 시 env 기본 모델만 노출한다. */
export async function listMemoModelCatalog(): Promise<MemoModelCatalog> {
  const ids = await fetchMemoProxyModelIds();
  if (ids === null || ids.length === 0) return buildMemoModelCatalog([]);
  // 조회 성공 시 프록시가 현재 노출하는 모델만 표시한다. env fallback도 목록에 있을 때만 포함.
  return buildMemoModelCatalog(ids, false);
}

/** true=현재 목록에 있음, false=사라짐, null=목록 조회 자체 실패(호출은 시도). */
export async function isMemoModelCurrentlyAvailable(
  modelId: string,
): Promise<boolean | null> {
  const ids = await fetchMemoProxyModelIds();
  return ids === null ? null : ids.includes(modelId);
}
