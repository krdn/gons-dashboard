import { yahooFetchJson, YahooFetchError } from "./yahoo-fetch";
import type {
  YahooQuoteResponse,
  YahooSearchResponse,
  YahooSearchQuote,
  YahooChartResponse,
} from "./yahoo-types";
import type {
  NormalizedQuote,
  NormalizedSearchResult,
  NormalizedFundamentals,
  AssetClass,
  Market,
} from "./normalized-types";
import { searchKrxSymbols, isHangul } from "./krx-symbols";

const QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search";
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

export { YahooFetchError };

// v7/finance/quote 가 일부 IP/UA 에서 401/403 Unauthorized 를 반환할 때
// v8 chart meta 로 폴백. chart meta 는 marketCap/PE/PBR 등 펀더멘털은 없지만
// price/changePct/currency 는 제공 → orchestrator 가 quote 만 있으면 분석 가능.
async function fetchQuoteFromChart(symbol: string): Promise<NormalizedQuote> {
  const url = `${CHART_URL}/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const data = await yahooFetchJson<YahooChartResponse>(url);
  if (!data.chart.result || data.chart.result.length === 0) {
    throw new YahooFetchError(`Yahoo chart empty for ${symbol}`);
  }
  const meta = data.chart.result[0].meta;
  const price = meta.regularMarketPrice ?? 0;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
  return {
    symbol: meta.symbol,
    price,
    changePct,
    currency: meta.currency ?? "USD",
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchYahooQuotes(
  symbols: string[],
): Promise<NormalizedQuote[]> {
  if (symbols.length === 0) return [];
  const url = `${QUOTE_URL}?symbols=${encodeURIComponent(symbols.join(","))}`;
  try {
    const data = await yahooFetchJson<YahooQuoteResponse>(url);
    if (data.quoteResponse.error) {
      throw new YahooFetchError(
        `Yahoo quote error: ${data.quoteResponse.error.description}`,
      );
    }
    const now = new Date().toISOString();
    return data.quoteResponse.result.map((r) => ({
      symbol: r.symbol,
      price: r.regularMarketPrice ?? 0,
      changePct: r.regularMarketChangePercent ?? 0,
      currency: r.currency ?? "USD",
      fetchedAt: now,
    }));
  } catch (err) {
    // v7 Unauthorized/403/empty → v8 chart 폴백. 심볼별 병렬 fetch.
    const results = await Promise.allSettled(
      symbols.map((s) => fetchQuoteFromChart(s)),
    );
    const ok = results
      .filter(
        (r): r is PromiseFulfilledResult<NormalizedQuote> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);
    if (ok.length === 0) {
      throw err instanceof Error
        ? err
        : new YahooFetchError(`Yahoo quote fallback failed: ${String(err)}`);
    }
    return ok;
  }
}

export async function fetchYahooFundamentals(
  symbol: string,
): Promise<NormalizedFundamentals> {
  const url = `${QUOTE_URL}?symbols=${encodeURIComponent(symbol)}`;
  const data = await yahooFetchJson<YahooQuoteResponse>(url);
  if (data.quoteResponse.error || data.quoteResponse.result.length === 0) {
    throw new YahooFetchError(`Yahoo fundamentals not found for ${symbol}`);
  }
  const r = data.quoteResponse.result[0];
  return {
    symbol: r.symbol,
    marketCap: r.marketCap,
    per: r.trailingPE,
    pbr: r.priceToBook,
    dividendYield: r.trailingAnnualDividendYield,
    ma50: r.fiftyDayAverage,
    ma200: r.twoHundredDayAverage,
  };
}

export async function fetchYahooDailyOHLC(
  symbol: string,
  range: "1mo" | "3mo" | "6mo" | "1y" | "5y" = "1y",
): Promise<Array<{ date: string; close: number; volume: number }>> {
  const url = `${CHART_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const data = await yahooFetchJson<YahooChartResponse>(url);
  if (!data.chart.result || data.chart.result.length === 0) {
    throw new YahooFetchError(`Yahoo chart empty for ${symbol}`);
  }
  const r = data.chart.result[0];
  const closes = r.indicators.quote[0]?.close ?? [];
  const volumes = r.indicators.quote[0]?.volume ?? [];
  return r.timestamp.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    close: closes[i] ?? 0,
    volume: volumes[i] ?? 0,
  }));
}

export async function fetchYahooSearch(
  query: string,
): Promise<NormalizedSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  // Yahoo v1/finance/search 는 한글 쿼리를 "Invalid Search Query" 로 거부 →
  // 로컬 KRX 정적 맵으로 폴백. 영문/숫자/티커는 기존 Yahoo 경로.
  if (isHangul(trimmed)) {
    return searchKrxSymbols(trimmed);
  }
  const url = `${SEARCH_URL}?q=${encodeURIComponent(trimmed)}&quotesCount=10&newsCount=0`;
  const data = await yahooFetchJson<YahooSearchResponse>(url);
  return data.quotes
    .filter((q) =>
      ["EQUITY", "CRYPTOCURRENCY", "FUTURE", "ETF"].includes(q.quoteType),
    )
    .map((q) => normalizeSearchQuote(q))
    .filter((r): r is NormalizedSearchResult => r !== null);
}

function normalizeSearchQuote(
  q: YahooSearchQuote,
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
