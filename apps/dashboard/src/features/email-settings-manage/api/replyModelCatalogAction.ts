"use server";

// 설정 다이얼로그가 열릴 때 lazy 로드하는 상세 모델 카탈로그.
// 홈 대시보드 렌더에 프록시 /v1/models fetch(3s timeout)를 얹지 않기 위해
// memo 설정 페이지(RSC prefetch)와 달리 Server Action 으로 분리.
import { auth } from "@/shared/lib/auth";
import { resolveReplyModelId } from "@/shared/lib/llm/reply-model-registry";
import { loadProviderModelCatalog } from "@/shared/lib/llm/provider-model-catalog-server";
import type { ReplyModelCatalogData } from "@/entities/email-settings/model/replyModel";

export async function replyModelCatalogAction(): Promise<ReplyModelCatalogData | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [gemini, codex, claude] = await Promise.all([
    resolveReplyModelId("gemini"),
    resolveReplyModelId("codex"),
    resolveReplyModelId("claude"),
  ]);
  const defaults = { gemini, codex, claude };
  const snapshot = await loadProviderModelCatalog({
    defaults,
    defaultMode: "always",
    allow: {
      // haiku 티어는 이메일 작성 거절(replyModel.ts 정책 주석) — 선택지에서 제외.
      claude: (modelId) => !modelId.toLowerCase().includes("haiku"),
    },
  });

  return { snapshot, defaults };
}
