import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { listMemos, listTransformationsByUser, type MemoTransformation } from "@/entities/memo/server";
import { MemoWidget } from "@/widgets/memo";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [memos, transformations] = await Promise.all([
    listMemos(session.user.id),
    listTransformationsByUser(session.user.id),
  ]);
  const transformationsByMemo: Record<string, MemoTransformation[]> = {};
  for (const t of transformations) {
    (transformationsByMemo[t.memoId] ??= []).push(t);
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="메모"
        subtitle="음성 또는 텍스트로 빠르게 기록해요."
        actions={
          <Link href="/memos/settings" className="text-sm text-neutral-500 hover:text-neutral-900">
            ⚙ AI 정리 설정
          </Link>
        }
      />
      <MemoWidget memos={memos} transformationsByMemo={transformationsByMemo} />
    </PageContainer>
  );
}
