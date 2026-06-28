import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { listTimeframeAnalyses } from "@/entities/stock-timeframe/server";
import { StocksView } from "@/widgets/stock-timeframe/StocksView";

export const dynamic = "force-dynamic";

export default async function StocksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const history = await listTimeframeAnalyses(session.user.id);

  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-12">
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-tight md:text-display">주식 타임프레임 분석</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          한국·미국 종목을 페르소나 × 장/중/단기 관점으로 분석합니다 (예: 삼성전자, AAPL · powered by tickerlens)
        </p>
      </div>
      <StocksView initialHistory={history} />
    </main>
  );
}
