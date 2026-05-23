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
import {
  fetchYahooQuotes,
  fetchYahooDailyOHLC,
  PERSONA_PROMPT_VERSION,
} from "@gons/stock-analysis";
import { SettingsButton } from "./SettingsButton";
import { HoldingDetailButton } from "./HoldingDetailButton";
import { AnalysisPendingPlaceholder } from "./AnalysisPendingPlaceholder";

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
    Promise.all(
      symbols.map((s) =>
        getCachedAnalysis(s, today, null, PERSONA_PROMPT_VERSION),
      ),
    ),
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

  // kind 별로 분리 — headline 은 보유 우선, 보유 없으면 관심.
  type EnrichedRow = (typeof enriched)[number];
  const enrichedHoldings = enriched.filter(
    (e) => e.holding.kind === "holding",
  );
  const enrichedWatchlist = enriched.filter(
    (e) => e.holding.kind === "watchlist",
  );

  const pickHeadline = (pool: EnrichedRow[]): EnrichedRow | undefined => {
    const cached = pool.filter((e) => e.analysis !== null);
    return cached.sort((a, b) => {
      const aScore = Number(a.analysis?.consensus.score.split("/")[0] ?? 0);
      const bScore = Number(b.analysis?.consensus.score.split("/")[0] ?? 0);
      return bScore - aScore;
    })[0];
  };

  const headline =
    pickHeadline(enrichedHoldings) ?? pickHeadline(enrichedWatchlist);
  const headlineSnapshot = headline?.analysis?.marketSnapshot;
  const headlineQuote = headline?.quote;
  const pendingHoldings = enriched
    .filter((e) => e.analysis === null)
    .map((e) => e.holding);

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

        {renderRowSection("보유", enrichedHoldings, headline?.holding.id)}
        {renderRowSection("관심", enrichedWatchlist, headline?.holding.id)}

        {/* 캐시 miss 종목 — Phase 6 lazy trigger placeholder */}
        {pendingHoldings.length > 0 && (
          <AnalysisPendingPlaceholder holdings={pendingHoldings} />
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

type EnrichedRowExport = {
  holding: Awaited<ReturnType<typeof getHoldings>>[number];
  quote: { price: number } | undefined;
  analysis: Awaited<ReturnType<typeof getCachedAnalysis>>;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
};

function renderRowSection(
  label: string,
  rows: EnrichedRowExport[],
  headlineId: string | undefined,
) {
  const cached = rows.filter(
    (e) => e.analysis !== null && e.holding.id !== headlineId,
  );
  if (cached.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label} ({rows.length})
      </div>
      {cached.map((e) => {
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
  );
}
