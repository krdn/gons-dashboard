import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getAgents } from "@/entities/agent/server";
import { AgentCatalog } from "@/widgets/agent-catalog";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const agents = getAgents();

  return (
    <PageContainer>
      <PageHeader
        title="Claude Code 에이전트"
        subtitle={`설치된 서브에이전트의 역할·모델·도구를 살펴봅니다 (${agents.length}개).`}
      />
      <AgentCatalog agents={agents} />
    </PageContainer>
  );
}
