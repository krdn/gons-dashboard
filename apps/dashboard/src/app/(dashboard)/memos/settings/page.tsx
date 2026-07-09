import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { listPresetCatalog } from "@/features/memo-transform/lib/preset-resolver";
import { PresetSettings } from "@/features/memo-preset-manage/ui/PresetSettings";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemoPresetSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const catalog = await listPresetCatalog(session.user.id);

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="AI 정리 스타일 설정"
        actions={
          <Link href="/memos" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← 메모
          </Link>
        }
      />
      <PresetSettings catalog={catalog} />
    </PageContainer>
  );
}
