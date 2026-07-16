import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { MemoHelpView, MEMO_HELP_GUIDE } from "@/widgets/memo-help";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemoHelpPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="메모 도움말"
        subtitle="메모 하나가 거치는 여정을 지도로 보고, 기능별 사용법을 확인해요."
        actions={
          <Link href="/memos" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← 메모
          </Link>
        }
      />
      <MemoHelpView guide={MEMO_HELP_GUIDE} />
    </PageContainer>
  );
}
