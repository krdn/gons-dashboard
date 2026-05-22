import "server-only";
import type {
  NormalizedQuote,
  NormalizedFundamentals,
  DartFinancials,
  MarketSnapshot,
} from "@gons/stock-analysis";
import {
  simpleMovingAverage,
  relativeStrengthIndex,
  lastFinite,
} from "@/shared/lib/ta/indicators";

/**
 * Yahoo + DART 결과를 우선순위 머지하여 MarketSnapshot 생성.
 * - DART 자체 계산 (trailingPER, derivedPBR, derivedDividendYield) 우선
 * - Yahoo 값 (marketCap, forwardPE) 폴백
 * - 가드: dart.eps > 0 일 때만 trailingPER 사용 (적자 종목 회피)
 *
 * Task 9 (PR 2) 에서 orchestrator 본문으로부터 추출 — 단위 테스트 가능성 + 책임 분리.
 */
export function mergeSnapshot(
  quote: NormalizedQuote,
  yahoo: NormalizedFundamentals | null,
  dart: DartFinancials | null,
  closes: number[],
): MarketSnapshot {
  const price = quote.price;

  const trailingPER =
    dart?.eps != null && dart.eps > 0 ? price / dart.eps : undefined;
  const derivedPBR =
    dart?.bps != null && dart.bps > 0 ? price / dart.bps : undefined;
  const derivedDividendYield =
    dart?.annualDPS != null && dart.annualDPS > 0 && price > 0
      ? (dart.annualDPS / price) * 100
      : undefined;

  const fundamentalsSource: "yahoo+dart" | "yahoo" | "none" =
    dart != null ? "yahoo+dart" : yahoo != null ? "yahoo" : "none";

  const fundamentalsAsOf =
    dart?.asOf ?? (yahoo ? new Date().toISOString().slice(0, 10) : undefined);

  return {
    price,
    changePct: quote.changePct,
    currency: quote.currency,
    marketCap: yahoo?.marketCap,
    per: trailingPER ?? yahoo?.per,
    pbr: derivedPBR ?? yahoo?.pbr,
    dividendYield: derivedDividendYield ?? yahoo?.dividendYield,
    trailingEPS: dart?.eps ?? undefined,
    trailingBPS: dart?.bps ?? undefined,
    revenueGrowthYoY: dart?.revenueGrowthYoY ?? undefined,
    opMarginPct: dart?.opMarginPct ?? undefined,
    dartReportPeriod: dart?.reportPeriod ?? undefined,
    fundamentalsSource,
    fundamentalsAsOf,
    ma20: lastFinite(simpleMovingAverage(closes, 20)),
    ma60: lastFinite(simpleMovingAverage(closes, 60)),
    rsi14: lastFinite(relativeStrengthIndex(closes, 14)),
    asOf: quote.fetchedAt,
  };
}
