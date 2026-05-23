// 일 2회 cron — 자산군별 라우팅.
//   ?market=KR        : KST 16:30 (KRX 장 마감 후)
//   ?market=US_GLOBAL : KST 06:30 (US 장 마감 + crypto/commodity 일중)
//
// 흐름:
//   1. portfolio_holdings 에서 market 필터로 unique symbol + holders 그룹핑
//   2. 각 symbol 별 analyzeStock (글로벌 캐시 갱신, packages/stock-analysis)
//   3. detectConsensusFlip(yesterday vs today) 1회 호출 — 글로벌 캐시라
//      holder 무관 결과 동일
//   4. flip 감지 시 holders 각각에 notifyFlip (flips INSERT + web-push)
import { sql } from "drizzle-orm";
import type { PortfolioHolding } from "@/entities/portfolio-holding/server";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { analyzeStock } from "@/features/stock-analysis-server";
import {
  detectConsensusFlip,
  notifyFlip,
} from "@/features/stock-push-flip";

export const dynamic = "force-dynamic";

/** KST 'YYYY-MM-DD' (offsetDays = -1 → 어제). */
function kstDate(offsetDays = 0): string {
  const now = new Date();
  const kst = new Date(
    now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 86_400_000,
  );
  return kst.toISOString().slice(0, 10);
}

type Market = "KR" | "US_GLOBAL";

interface SymbolTarget {
  symbol: string;
  displayName: string;
  assetClass: PortfolioHolding["assetClass"];
  market: PortfolioHolding["market"];
  holders: Array<{
    userId: string;
    kind: "holding" | "watchlist";
    pushOptIn: boolean;
  }>;
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = (searchParams.get("market") ?? "") as Market;

  if (market !== "KR" && market !== "US_GLOBAL") {
    return new Response(
      JSON.stringify({ error: "market=KR|US_GLOBAL 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // DB 의 portfolio_holdings.market 은 packages/stock-analysis 의 Market 타입
  // ("NASDAQ" | "NYSE" | "KRX" | "CRYPTO" | "COMMODITY") 와 정합.
  // query string 의 market=KR|US_GLOBAL 은 그룹 구분 키이므로 SQL 매핑은 분리.
  const marketFilter =
    market === "KR"
      ? sql`${portfolioHoldings.market} = 'KRX'`
      : sql`${portfolioHoldings.market} IN ('NASDAQ','NYSE','CRYPTO','COMMODITY')`;

  const handler = createCronHandler<
    SymbolTarget,
    { cached: boolean; flipped: number; notified: number }
  >({
    name: `stock-analyze-${market.toLowerCase()}`,
    targetSelect: async () => {
      const rows = await db
        .select({
          symbol: portfolioHoldings.symbol,
          displayName: portfolioHoldings.displayName,
          assetClass: portfolioHoldings.assetClass,
          market: portfolioHoldings.market,
          userId: portfolioHoldings.userId,
          kind: portfolioHoldings.kind,
          pushOptIn: portfolioHoldings.pushOptIn,
        })
        .from(portfolioHoldings)
        .where(marketFilter);

      const grouped = new Map<string, SymbolTarget>();
      for (const r of rows) {
        const holder = {
          userId: r.userId,
          kind: r.kind as "holding" | "watchlist",
          pushOptIn: r.pushOptIn,
        };
        const existing = grouped.get(r.symbol);
        if (existing) {
          existing.holders.push(holder);
        } else {
          grouped.set(r.symbol, {
            symbol: r.symbol,
            displayName: r.displayName,
            assetClass: r.assetClass as PortfolioHolding["assetClass"],
            market: r.market as PortfolioHolding["market"],
            holders: [holder],
          });
        }
      }
      return [...grouped.values()];
    },
    getId: (t) => t.symbol,
    getLabel: (t) => `${t.symbol} (${t.holders.length}명)`,
    perTarget: async (t) => {
      // 1. 글로벌 캐시 갱신.
      // analyzeStock 내부가 항상 userId=null 로 cache upsert (글로벌 캐시 정책).
      // 호출 시 넘기는 userId 는 persona model override resolve 용도 — 첫 holder 사용.
      const firstHolder = t.holders[0];
      const result = await analyzeStock({
        symbol: t.symbol,
        displayName: t.displayName,
        assetClass: t.assetClass,
        market: t.market,
        userId: firstHolder.userId,
      });

      // 2. flip detect 1회 (글로벌 캐시라 holder 무관 동일 결과).
      const detection = await detectConsensusFlip({
        symbol: t.symbol,
        yesterdayDate: kstDate(-1),
        todayDate: kstDate(0),
      });

      let flipped = 0;
      let notified = 0;
      if (detection) {
        for (const holder of t.holders) {
          // watchlist 이고 pushOptIn=false 면 알림 skip (기본값)
          if (holder.kind === "watchlist" && !holder.pushOptIn) continue;
          flipped += 1;
          const notifyResult = await notifyFlip({
            userId: holder.userId,
            detection,
            displayName: t.displayName,
          });
          if (notifyResult.kind === "notified") notified += 1;
        }
      }

      return {
        cached: result.status !== "failed",
        flipped,
        notified,
      };
    },
    concurrency: 2,
  });

  return handler(request);
}
