// Yahoo Finance 어댑터 — yahoo-finance2 v3 client 사용.
//
// 배경 (2026-05-22 진단):
// - Yahoo v7 `/finance/quote` 가 익명 호출에 401 Unauthorized (crumb cookie 요구).
//   → 직접 fetch 폴백 (yahoo-fetch.ts) 으로는 fundamentals 회복 불가.
// - v8 `/finance/chart` 도 익명 rate-limit (429) 으로 신뢰 불가.
// - yahoo-finance2 는 cookie/crumb 자동 관리 + retry → v8 quoteSummary endpoint 정상 동작.
//
// 단, Yahoo 가 KR 종목 (.KS/.KQ) 펀더멘털을 모듈별로 분산 제공:
// - summaryDetail: dividendYield, trailingPE (KR 은 missing 빈번)
// - defaultKeyStatistics: forwardPE, priceToBook (PBR), trailingEps
// - price: marketCap, currency, regularMarketPrice
// - financialData: totalRevenue
// → fetchYahooFundamentals 에서 trailingPE 우선, 없으면 forwardPE 폴백.

import { getYahooClient } from "./yahoo-finance2-client";
import { YahooFetchError } from "./yahoo-fetch";
import type {
  NormalizedQuote,
  NormalizedSearchResult,
  NormalizedFundamentals,
  AssetClass,
  Market,
} from "./normalized-types";
import { searchKrxSymbols, isHangul } from "./krx-symbols";

// yahoo-finance2 의 메서드 return type overload 가 union 으로 분기되어 lazy resolution
// 시 `never` 로 추론되는 케이스가 있다. 명시 타입을 import 해서 캐스트.
import type {
  ChartResultArray,
  ChartResultArrayQuote,
} from "yahoo-finance2/modules/chart";
import type { SearchResult } from "yahoo-finance2/modules/search";
import type { Quote } from "yahoo-finance2/modules/quote";
import type { QuoteSummaryResult } from "yahoo-finance2/modules/quoteSummary-iface";

export { YahooFetchError };

export async function fetchYahooQuotes(
  symbols: string[],
): Promise<NormalizedQuote[]> {
  if (symbols.length === 0) return [];
  const yf = getYahooClient();
  const results = await Promise.allSettled(
    symbols.map(async (s): Promise<NormalizedQuote> => {
      const q = (await yf.quote(s)) as Quote;
      const price = q.regularMarketPrice ?? 0;
      const changePct = q.regularMarketChangePercent ?? 0;
      return {
        symbol: q.symbol ?? s,
        price,
        changePct,
        currency: q.currency ?? "USD",
        fetchedAt: new Date().toISOString(),
      };
    }),
  );
  const ok = results
    .filter(
      (r): r is PromiseFulfilledResult<NormalizedQuote> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
  if (ok.length === 0) {
    const firstReject = results.find((r) => r.status === "rejected");
    const reason =
      firstReject?.status === "rejected"
        ? String(
            firstReject.reason instanceof Error
              ? firstReject.reason.message
              : firstReject.reason,
          )
        : "unknown";
    throw new YahooFetchError(
      `Yahoo quote 전체 실패 (${symbols.length} symbols): ${reason}`,
    );
  }
  return ok;
}

export async function fetchYahooFundamentals(
  symbol: string,
): Promise<NormalizedFundamentals> {
  const yf = getYahooClient();
  const qs = (await yf.quoteSummary(symbol, {
    modules: [
      "price",
      "summaryDetail",
      "defaultKeyStatistics",
      "financialData",
    ],
  })) as QuoteSummaryResult;
  const price = qs.price;
  const summary = qs.summaryDetail;
  const keyStats = qs.defaultKeyStatistics;
  return {
    symbol: price?.symbol ?? symbol,
    marketCap: numOrUndef(price?.marketCap),
    // trailingPE 우선, 없으면 forwardPE (KR 종목은 trailing 비제공 흔함).
    per: numOrUndef(summary?.trailingPE) ?? numOrUndef(keyStats?.forwardPE),
    pbr: numOrUndef(keyStats?.priceToBook),
    dividendYield:
      numOrUndef(summary?.trailingAnnualDividendYield) ??
      numOrUndef(summary?.dividendYield),
    ma50: numOrUndef(summary?.fiftyDayAverage),
    ma200: numOrUndef(summary?.twoHundredDayAverage),
  };
}

export async function fetchYahooDailyOHLC(
  symbol: string,
  range: "1mo" | "3mo" | "6mo" | "1y" | "5y" = "1y",
): Promise<Array<{ date: string; close: number; volume: number }>> {
  const yf = getYahooClient();
  // yahoo-finance2 의 chart() 는 period1 (시작일) 필수 — range → period1 변환.
  const now = new Date();
  const start = new Date(now);
  const months: Record<typeof range, number> = {
    "1mo": 1,
    "3mo": 3,
    "6mo": 6,
    "1y": 12,
    "5y": 60,
  };
  start.setMonth(start.getMonth() - months[range]);
  const result = (await yf.chart(symbol, {
    period1: start,
    period2: now,
    interval: "1d",
  })) as ChartResultArray;
  return result.quotes
    .map((q: ChartResultArrayQuote) => ({
      date: q.date.toISOString().slice(0, 10),
      close: q.close ?? 0,
      volume: q.volume ?? 0,
    }))
    .filter((row: { close: number }) => row.close > 0);
}

export async function fetchYahooSearch(
  query: string,
): Promise<NormalizedSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  // Yahoo search 가 한글 쿼리를 "Invalid Search Query" 로 거부 → 로컬 KRX 정적 맵으로 폴백.
  if (isHangul(trimmed)) {
    return searchKrxSymbols(trimmed);
  }
  const yf = getYahooClient();
  type SearchQuote = SearchResult["quotes"][number];
  const data = (await yf.search(trimmed, {
    quotesCount: 10,
    newsCount: 0,
  })) as SearchResult;
  return data.quotes
    .filter(
      (
        q: SearchQuote,
      ): q is SearchQuote & { symbol: string; quoteType: string } =>
        typeof q.symbol === "string" &&
        typeof q.quoteType === "string" &&
        ["EQUITY", "CRYPTOCURRENCY", "FUTURE", "ETF"].includes(q.quoteType),
    )
    .map((q: SearchQuote & { symbol: string; quoteType: string }) =>
      normalizeSearchQuote({
        symbol: q.symbol,
        quoteType: q.quoteType,
        exchange:
          "exchange" in q ? (q.exchange as string | undefined) : undefined,
        exchDisp:
          "exchDisp" in q ? (q.exchDisp as string | undefined) : undefined,
        longname:
          "longname" in q ? (q.longname as string | undefined) : undefined,
        shortname:
          "shortname" in q ? (q.shortname as string | undefined) : undefined,
      }),
    )
    .filter(
      (r: NormalizedSearchResult | null): r is NormalizedSearchResult =>
        r !== null,
    );
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

interface SearchQuoteShape {
  symbol: string;
  quoteType: string;
  exchange?: string;
  exchDisp?: string;
  longname?: string;
  shortname?: string;
}

function normalizeSearchQuote(
  q: SearchQuoteShape,
): NormalizedSearchResult | null {
  const displayName = q.longname ?? q.shortname ?? q.symbol;
  const mapped = mapAssetClassAndMarket(q.symbol, q.quoteType, q.exchange);
  if (!mapped) return null;
  return {
    symbol: q.symbol,
    displayName,
    assetClass: mapped.assetClass,
    market: mapped.market,
    exchange: q.exchDisp ?? q.exchange ?? mapped.market,
  };
}

function mapAssetClassAndMarket(
  symbol: string,
  quoteType: string,
  exchange?: string,
): { assetClass: AssetClass; market: Market } | null {
  if (quoteType === "CRYPTOCURRENCY" || symbol.endsWith("-USD")) {
    return { assetClass: "crypto", market: "CRYPTO" };
  }
  if (quoteType === "FUTURE" || symbol.endsWith("=F")) {
    return { assetClass: "commodity", market: "COMMODITY" };
  }
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) {
    return { assetClass: "stock", market: "KRX" };
  }
  const ex = exchange?.toUpperCase() ?? "";
  if (ex.includes("NMS") || ex.includes("NCM") || ex === "NASDAQ") {
    return { assetClass: "stock", market: "NASDAQ" };
  }
  if (ex.includes("NYQ") || ex === "NYSE") {
    return { assetClass: "stock", market: "NYSE" };
  }
  // 알 수 없는 거래소 — NYSE 폴백. v1.1 에서 KIS/Polygon 폴백 도입 시 재검토.
  // ETF 는 quoteType === "ETF" 필터로 통과한 후 거래소 코드로 매핑됨 → stock 으로 폴백.
  return { assetClass: "stock", market: "NYSE" };
}
