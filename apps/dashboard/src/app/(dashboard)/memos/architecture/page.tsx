import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { MemoArchitectureView, ARCHITECTURE_GRAPH } from "@/widgets/memo-architecture";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemoArchitecturePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="메모 시스템 아키텍처"
        subtitle="흐름을 골라 레이어별 구조를 보고, 노드를 클릭해 파일·심볼·유지보수 명령을 확인해요."
        actions={
          <Link href="/memos" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← 메모
          </Link>
        }
      />
      <MemoArchitectureView graph={ARCHITECTURE_GRAPH} />
    </PageContainer>
  );
}
