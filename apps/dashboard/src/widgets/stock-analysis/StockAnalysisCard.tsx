import "server-only";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import { getHoldings } from "@/entities/portfolio-holding/server";
import { getCachedAnalysis } from "@/entities/stock-analysis/server";
import type {
  ModelName,
  PersonaOrConsensus,
} from "@/entities/stock-analysis/server";
import { fetchYahooQuotes, fetchYahooDailyOHLC } from "@gons/stock-analysis";
import { SettingsButton } from "./SettingsButton";
import { HoldingDetailButton } from "./HoldingDetailButton";

export async function StockAnalysisCard() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const holdings = await getHoldings(session.user.id);
  if (holdings.length === 0) {
    return <EmptyCard />;
  }

  // 사용자 모델 override (DB 의 Record<string, ModelName> 을 PersonaOrConsensus 키로 narrow).
  const overridesRow = await db
    .select()
    .from(stockPersonaPreferences)
    .where(eq(stockPersonaPreferences.userId, session.user.id))
    .limit(1);
  const initialOverrides = (overridesRow[0]?.overrides ?? {}) as Partial<
    Record<PersonaOrConsensus, ModelName>
  >;

  // 시세 (배치) + 캐시 분석 + 일봉
  const symbols = holdings.map((h) => h.symbol);
  // yyyy-MM-dd in UTC (서버 TZ=Asia/Seoul 이라 KST 자정 기준이지만 분석 캐시 키는 UTC 일자로 통일).
  const today = new Date().toISOString().slice(0, 10);
  const [quotes, analyses, dailySets] = await Promise.all([
    fetchYahooQuotes(symbols).catch(() => []),
    Promise.all(symbols.map((s) => getCachedAnalysis(s, today, null))),
    Promise.all(
      symbols.map((s) => fetchYahooDailyOHLC(s, "1y").catch(() => [])),
    ),
  ]);
  const quoteBySymbol = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  const enriched = holdings.map((h, i) => ({
    holding: h,
    quote: quoteBySymbol[h.symbol],
    analysis: analyses[i],
    dailyOHLC: dailySets[i],
  }));

  // 헤드라인 = 합의 score 가장 강한 종목.
  const cached = enriched.filter((e) => e.analysis !== null);
  const headline = cached.sort((a, b) => {
    const aScore = Number(a.analysis?.consensus.score.split("/")[0] ?? 0);
    const bScore = Number(b.analysis?.consensus.score.split("/")[0] ?? 0);
    return bScore - aScore;
  })[0];

  const headlineSnapshot = headline?.analysis?.marketSnapshot;
  const headlineQuote = headline?.quote;
  const pendingCount = enriched.filter((e) => e.analysis === null).length;

  return (
    <section
      aria-labelledby="stock-analysis-heading"
      className="col-span-1 max-w-[760px]"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2
          id="stock-analysis-heading"
          className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          <span>포트폴리오 분석</span>
          <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">
            {holdings.length}종목
          </span>
        </h2>
        <SettingsButton
          initialHoldings={holdings}
          initialOverrides={initialOverrides}
        />
      </header>

      <div className="flex flex-col gap-3">
        {headline && headline.analysis && headlineSnapshot && (
          <HoldingDetailButton
            holding={headline.holding}
            personas={headline.analysis.personas}
            consensus={headline.analysis.consensus}
            snapshot={
              headlineQuote
                ? { ...headlineSnapshot, price: headlineQuote.price }
                : headlineSnapshot
            }
            dailyOHLC={headline.dailyOHLC}
            variant="hero"
          />
        )}

        {cached.length > 1 && (
          <div className="flex flex-col gap-1">
            {cached
              .filter((e) => e.holding.id !== headline?.holding.id)
              .map((e) => {
                if (!e.analysis) return null;
                const snap = e.quote
                  ? { ...e.analysis.marketSnapshot, price: e.quote.price }
                  : e.analysis.marketSnapshot;
                return (
                  <HoldingDetailButton
                    key={e.holding.id}
                    holding={e.holding}
                    personas={e.analysis.personas}
                    consensus={e.analysis.consensus}
                    snapshot={snap}
                    dailyOHLC={e.dailyOHLC}
                    variant="row"
                  />
                );
              })}
          </div>
        )}

        {/* 캐시 miss 종목 — Phase 6 lazy trigger placeholder */}
        {pendingCount > 0 && (
          <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-3 text-xs text-[var(--color-text-muted)]">
            {pendingCount}개 종목 분석 대기 중 (Phase 6: 자동 생성)
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyCard() {
  return (
    <section
      aria-labelledby="stock-analysis-heading"
      className="col-span-1 max-w-[760px]"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2
          id="stock-analysis-heading"
          className="text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          포트폴리오 분석
        </h2>
        <SettingsButton initialHoldings={[]} initialOverrides={{}} />
      </header>
      <div className="rounded-xl border border-dashed border-[var(--color-hairline)] p-6 text-center text-sm text-[var(--color-text-muted)]">
        <p>아직 등록된 종목이 없습니다.</p>
        <p className="mt-1 text-xs">
          우상단 ⚙ 클릭 → 포트폴리오에서 추가하세요.
        </p>
      </div>
    </section>
  );
}
