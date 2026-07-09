import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { listMemos } from "@/entities/memo/server";
import { MemoWidget } from "@/widgets/memo";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const memos = await listMemos(session.user.id);

  return (
    <PageContainer width="narrow">
      <PageHeader title="메모" subtitle="음성 또는 텍스트로 빠르게 기록해요." />
      <MemoWidget memos={memos} />
    </PageContainer>
  );
}
