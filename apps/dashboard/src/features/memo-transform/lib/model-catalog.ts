import "server-only";
import {
  MEMO_MODEL_RECOMMENDATION_RULES,
  type MemoModelSelection,
} from "@/entities/memo/client";
import {
  deriveModelOptions,
  type ModelAvailability,
  type ProviderModelCatalogSnapshot,
} from "@/shared/lib/llm/provider-model-catalog";
import { loadProviderModelCatalog } from "@/shared/lib/llm/provider-model-catalog-server";
import { resolveMemoModelId } from "./model-registry";

function memoDefaults() {
  return {
    claude: resolveMemoModelId("claude"),
    codex: resolveMemoModelId("codex"),
    gemini: resolveMemoModelId("gemini"),
  };
}

/**
 * cli-proxy-api의 현재 /v1/models 카탈로그 snapshot.
 * source-failure-only: 조회 성공 시 프록시가 노출하는 모델만 표시하고
 * (env 기본도 목록에 있을 때만), 조회 실패 시에만 env 기본으로 폴백한다.
 */
export async function loadMemoModelCatalog(): Promise<ProviderModelCatalogSnapshot> {
  return loadProviderModelCatalog({
    defaults: memoDefaults(),
    defaultMode: "source-failure-only",
  });
}

/** available=현재 목록에 있음, unavailable=사라짐, unknown=조회 실패(호출은 시도). */
export async function getMemoModelAvailability(
  selection: MemoModelSelection,
): Promise<ModelAvailability> {
  const snapshot = await loadMemoModelCatalog();
  return deriveModelOptions({
    snapshot,
    selection: { provider: selection.model, modelId: selection.modelId },
    recommendationRules: MEMO_MODEL_RECOMMENDATION_RULES,
  }).availability;
}
