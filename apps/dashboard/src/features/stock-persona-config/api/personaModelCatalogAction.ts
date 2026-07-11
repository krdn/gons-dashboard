"use server";

// 포트폴리오 설정 모달의 LLM 모델 탭이 열릴 때 lazy 로드하는 상세 모델 카탈로그.
// 홈 대시보드 렌더에 프록시 /v1/models fetch(3s timeout)를 얹지 않기 위해
// Server Action 으로 분리 (email replyModelCatalogAction 패턴 미러).
import { auth } from "@/shared/lib/auth";
import { resolveLatestModel } from "@/shared/lib/llm/resolve-latest-model";
import { loadProviderModelCatalog } from "@/shared/lib/llm/provider-model-catalog-server";
import type { PersonaModelCatalogData } from "@/entities/stock-analysis/server";

export async function personaModelCatalogAction(): Promise<PersonaModelCatalogData | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  // tier 매핑은 persona-router 의 resolvePersonaModels 와 동일해야 한다.
  const [claude, codex, gemini] = await Promise.all([
    resolveLatestModel("opus"),
    resolveLatestModel("gpt"),
    resolveLatestModel("gemini-pro"),
  ]);
  const defaults = { claude, codex, gemini };
  const snapshot = await loadProviderModelCatalog({
    defaults,
    defaultMode: "always",
  });

  return { snapshot, defaults };
}
