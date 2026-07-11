import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import {
  listPresetCatalog,
  resolveDefaultMemoModel,
} from "@/features/memo-transform/lib/preset-resolver";
import { loadMemoModelCatalog } from "@/features/memo-transform/lib/model-catalog";
import { PresetSettings } from "@/features/memo-preset-manage/ui/PresetSettings";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemoPresetSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [catalog, defaultModel, modelCatalogSnapshot] = await Promise.all([
    listPresetCatalog(session.user.id),
    resolveDefaultMemoModel(session.user.id),
    loadMemoModelCatalog(),
  ]);

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="AI 정리 스타일 설정"
        actions={
          <Link
            href="/memos"
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            ← 메모
          </Link>
        }
      />
      <PresetSettings
        catalog={catalog}
        initialDefaultModel={defaultModel}
        modelCatalogSnapshot={modelCatalogSnapshot}
      />
    </PageContainer>
  );
}
