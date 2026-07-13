import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import {
  listMemos,
  listTransformationsByUser,
  listActionItemsByUser,
  listCategories,
  type MemoActionItem,
  type MemoTransformation,
} from "@/entities/memo/server";
import { listPresetCatalog } from "@/features/memo-transform/lib/preset-resolver";
import { MemoWidget } from "@/widgets/memo";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [memos, transformations, catalog, actionItems, categories] = await Promise.all([
    listMemos(session.user.id),
    listTransformationsByUser(session.user.id),
    listPresetCatalog(session.user.id),
    // 패널은 진행 중 항목만 — dismissed/done은 숨김 (스펙 memo-action-extraction §5).
    listActionItemsByUser(session.user.id, ["proposed", "accepted"]),
    listCategories(),
  ]);
  const transformationsByMemo: Record<string, MemoTransformation[]> = {};
  for (const t of transformations) {
    (transformationsByMemo[t.memoId] ??= []).push(t);
  }
  const actionItemsByMemo: Record<string, MemoActionItem[]> = {};
  for (const item of actionItems) {
    (actionItemsByMemo[item.memoId] ??= []).push(item);
  }
  const presetOptions = catalog.map(({ slug, label, minInputLen }) => ({ slug, label, minInputLen }));

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="메모"
        subtitle="음성 또는 텍스트로 빠르게 기록해요."
        actions={
          <div className="flex items-center gap-3">
            <Link href="/memos/architecture" className="text-sm text-neutral-500 hover:text-neutral-900">
              🗺 시스템 구조
            </Link>
            <Link href="/memos/settings" className="text-sm text-neutral-500 hover:text-neutral-900">
              ⚙ AI 정리 설정
            </Link>
          </div>
        }
      />
      <MemoWidget
        memos={memos}
        transformationsByMemo={transformationsByMemo}
        presets={presetOptions}
        actionItemsByMemo={actionItemsByMemo}
        categories={categories.map(({ id, labelKo }) => ({ id, labelKo }))}
      />
    </PageContainer>
  );
}
