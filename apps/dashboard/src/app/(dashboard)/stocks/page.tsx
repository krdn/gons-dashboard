import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { listTimeframeAnalyses } from "@/entities/stock-timeframe/server";
import { StocksView } from "@/widgets/stock-timeframe/StocksView";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function StocksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const history = await listTimeframeAnalyses(session.user.id);

  return (
    <PageContainer>
      <PageHeader
        title="주식 타임프레임 분석"
        subtitle="한국·미국 종목을 페르소나 × 장/중/단기 관점으로 분석합니다 (예: 삼성전자, AAPL · powered by tickerlens)"
      />
      <StocksView initialHistory={history} />
    </PageContainer>
  );
}
