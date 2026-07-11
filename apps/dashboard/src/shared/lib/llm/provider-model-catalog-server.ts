import "server-only";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";
import type {
  LlmProviderKey,
  ProviderModelCatalog,
} from "./provider-model-catalog";
import {
  createProviderModelCatalogLoader,
  ProviderModelSourceError,
} from "./provider-model-catalog-loader";

export type { ProviderModelCatalogPolicy } from "./provider-model-catalog-loader";

async function fetchProxyModelIds(): Promise<readonly string[]> {
  let response: Response;
  try {
    response = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/models`, {
      headers: { "x-api-key": env.ANTHROPIC_API_KEY },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "connection";
    throw new ProviderModelSourceError({ reason });
  }

  if (!response.ok) {
    throw new ProviderModelSourceError({
      reason: "http",
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProviderModelSourceError({
      reason: "invalid-json",
      status: response.status,
    });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    !Array.isArray(body.data)
  ) {
    return [];
  }

  return body.data
    .map((item) =>
      typeof item === "object" && item !== null && "id" in item
        ? item.id
        : null,
    )
    .filter((id): id is string => typeof id === "string");
}

export const loadProviderModelCatalog = createProviderModelCatalogLoader(
  fetchProxyModelIds,
  (failure) =>
    logger.warn("provider-model-catalog", "source-fallback", { ...failure }),
);

/** @deprecated Use loadProviderModelCatalog with an explicit policy. */
export async function listProviderModelCatalog(
  defaults: Record<LlmProviderKey, string>,
): Promise<ProviderModelCatalog> {
  return (await loadProviderModelCatalog({ defaults, defaultMode: "always" }))
    .catalog;
}
