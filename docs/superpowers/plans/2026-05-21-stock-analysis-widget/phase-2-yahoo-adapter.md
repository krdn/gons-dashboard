# Phase 2: Yahoo Finance Adapter

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** `packages/stock-analysis/src/adapters/yahoo.ts` 를 작성하고 dashboard 의 `/api/stock/search` + `/api/stock/quote` route 로 노출. Vitest mock 테스트로 검증. Phase 1 의 entities/stock placeholder 를 실제 구현으로 교체.

**완료 조건:**
- Yahoo Finance 4 함수 (quote / 일봉 / 펀더멘털 / search) 가 timeout + retry 1회 처리 포함하여 동작
- `/api/stock/search?q=...` 가 NextAuth 인증 후 검색 결과 반환
- `/api/stock/quote?symbols=...` 가 인증 후 배치 시세 반환
- Vitest unit 테스트 11개 이상 (정상/timeout/rate-limit/empty/자산군 매핑)
- `entities/stock/server.ts` 의 placeholder 가 yahoo adapter 호출로 교체됨
- `pnpm typecheck && pnpm lint && pnpm test` PASS

**전제:**
- Phase 1 PR (#106) 머지 완료 → main 에서 작업 브랜치 `feat/stock-analysis-phase-2` 컷
- `@gons/stock-analysis` 패키지가 dashboard dependency 로 인식됨
- `stockAnalysisCache` 등 Drizzle 테이블이 schema 에 존재

---

## Task 2.1: Yahoo adapter 타입 정의

**Files:**
- Create: `packages/stock-analysis/src/adapters/yahoo-types.ts`

스코프와 책임 격리를 위해 adapter 의 raw fetch 응답 타입을 별도 파일로 정의. Yahoo API 스키마 변경 시 한 곳만 수정.

- [ ] **Step 1: yahoo-types.ts 작성**

```ts
export interface YahooQuoteRaw {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  currency?: string;
  shortName?: string;
  longName?: string;
  marketCap?: number;
  trailingPE?: number;
  priceToBook?: number;
  trailingAnnualDividendYield?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
}

export interface YahooQuoteResponse {
  quoteResponse: {
    result: YahooQuoteRaw[];
    error: { code: string; description: string } | null;
  };
}

export interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType: string; // 'EQUITY' | 'CRYPTOCURRENCY' | 'FUTURE' | 'ETF' | ...
  exchange?: string;
  exchDisp?: string;
}

export interface YahooSearchResponse {
  quotes: YahooSearchQuote[];
  count?: number;
}

export interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: { symbol: string; regularMarketPrice?: number; currency?: string };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @gons/stock-analysis typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/stock-analysis/src/adapters/yahoo-types.ts
git commit -m "feat(stock-analysis): Yahoo Finance raw 응답 타입 정의"
```

---

## Task 2.2: yahooFetchJson helper

**Files:**
- Create: `packages/stock-analysis/src/adapters/yahoo-fetch.ts`

5초 timeout + retry 1회 + UA 헤더 (Yahoo 가 default Node fetch UA 를 거부할 수 있음).

- [ ] **Step 1: yahoo-fetch.ts 작성**

```ts
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY = 1;
const UA = "Mozilla/5.0 (gons-dashboard/0.1; stock-analysis adapter)";

export class YahooFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "YahooFetchError";
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retry?: number;
}

export async function yahooFetchJson<T>(
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.retry ?? DEFAULT_RETRY;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        throw new YahooFetchError(
          `Yahoo ${res.status} ${res.statusText}`,
          res.status,
          url,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  throw new YahooFetchError(
    `Yahoo fetch failed after ${maxRetries + 1} attempts: ${lastError?.message ?? "unknown"}`,
    undefined,
    url,
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @gons/stock-analysis typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/stock-analysis/src/adapters/yahoo-fetch.ts
git commit -m "feat(stock-analysis): yahooFetchJson helper (timeout + retry + UA)"
```

---

## Task 2.3: Yahoo adapter — search / quote / fundamentals / OHLC

**Files:**
- Create: `packages/stock-analysis/src/adapters/normalized-types.ts`
- Create: `packages/stock-analysis/src/adapters/yahoo.ts`
- Modify: `packages/stock-analysis/src/index.ts` (public export 추가)

⚠️ **shape 일치 필수:** Phase 1 T1.4 가 정의한 entities/stock 의 `Quote` / `SearchResult` 와 동일 shape. T2.7 에서 entities 가 이 패키지 타입을 re-export 하도록 통합.

- [ ] **Step 1: normalized-types.ts 작성**

```ts
export type AssetClass = "stock" | "crypto" | "commodity";
export type Market = "NASDAQ" | "NYSE" | "KRX" | "CRYPTO" | "COMMODITY";

export interface NormalizedQuote {
  symbol: string;
  price: number;
  changePct: number;
  currency: string;
  fetchedAt: string; // ISO 8601
}

export interface NormalizedSearchResult {
  symbol: string;
  displayName: string;
  assetClass: AssetClass;
  market: Market;
  exchange: string;
}

export interface NormalizedFundamentals {
  symbol: string;
  marketCap?: number;
  per?: number;
  pbr?: number;
  dividendYield?: number;
  ma50?: number;
  ma200?: number;
}
```

- [ ] **Step 2: yahoo.ts 작성**

```ts
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

const QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search";
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

export { YahooFetchError };

export async function fetchYahooQuotes(
  symbols: string[],
): Promise<NormalizedQuote[]> {
  if (symbols.length === 0) return [];
  const url = `${QUOTE_URL}?symbols=${encodeURIComponent(symbols.join(","))}`;
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
  // 알 수 없는 거래소 — 일단 NYSE 폴백. v1.1 에서 KIS/Polygon 폴백 도입 시 재검토.
  return { assetClass: "stock", market: "NYSE" };
}
```

⚠️ **ETF 처리:** spec §6.4 의 AssetClass union 이 `stock | crypto | commodity` 3종이라 ETF 별도 카테고리 없음. Yahoo 의 `quoteType === "ETF"` 결과는 위 mapping 에서 거래소 코드 기반으로 stock + NASDAQ/NYSE 로 폴백 — UI 에서 일반 주식과 동일 취급. v1.0 의도된 단순화.

- [ ] **Step 3: index.ts 에 public export 추가**

```ts
// Public API for @gons/stock-analysis package.
export {
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooDailyOHLC,
  fetchYahooSearch,
  YahooFetchError,
} from "./adapters/yahoo";
export type {
  NormalizedQuote,
  NormalizedSearchResult,
  NormalizedFundamentals,
  AssetClass,
  Market,
} from "./adapters/normalized-types";
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @gons/stock-analysis typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/stock-analysis/src/adapters/ packages/stock-analysis/src/index.ts
git commit -m "feat(stock-analysis): Yahoo adapter (quote/fundamentals/OHLC/search) + 자산군 매핑"
```

---

## Task 2.4: Vitest unit 테스트

**Files:**
- Create: `packages/stock-analysis/tests/yahoo.test.ts`

`global.fetch` mock 으로 정상 / error / 매핑 / empty 11+ 케이스.

- [ ] **Step 1: 정상 + empty 케이스 (RED → GREEN)**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooSearch,
  YahooFetchError,
} from "../src";

function mockFetchOk(response: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: vi.fn().mockResolvedValue(response),
  } as unknown as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchYahooQuotes", () => {
  it("정상: 1 종목 quote 를 normalize 한다", async () => {
    global.fetch = mockFetchOk({
      quoteResponse: {
        result: [
          {
            symbol: "AAPL",
            regularMarketPrice: 180.5,
            regularMarketChangePercent: 1.2,
            currency: "USD",
          },
        ],
        error: null,
      },
    });
    const result = await fetchYahooQuotes(["AAPL"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      symbol: "AAPL",
      price: 180.5,
      changePct: 1.2,
      currency: "USD",
    });
    expect(result[0].fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("빈 symbols 배열은 빈 결과 + 네트워크 호출 없음", async () => {
    const fetchMock = mockFetchOk({});
    global.fetch = fetchMock;
    const result = await fetchYahooQuotes([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @gons/stock-analysis test`
Expected: 2 PASS.

- [ ] **Step 2: rate-limit / error 케이스**

```ts
describe("fetchYahooQuotes — error paths", () => {
  it("429 rate-limit 은 1회 재시도 후 throw", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: vi.fn(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: vi.fn(),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const promise = fetchYahooQuotes(["AAPL"]);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(YahooFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("Yahoo 가 error 필드 반환 시 throw", async () => {
    global.fetch = mockFetchOk({
      quoteResponse: {
        result: [],
        error: { code: "Bad Request", description: "invalid" },
      },
    });
    await expect(fetchYahooQuotes(["BAD"])).rejects.toThrow(/invalid/);
  });
});
```

Run: `pnpm --filter @gons/stock-analysis test`
Expected: 4 PASS 총.

- [ ] **Step 3: search 자산군 매핑 케이스**

```ts
describe("fetchYahooSearch — 자산군 매핑", () => {
  it("EQUITY + exchange NMS → NASDAQ stock", async () => {
    global.fetch = mockFetchOk({
      quotes: [
        {
          symbol: "AAPL",
          longname: "Apple Inc.",
          quoteType: "EQUITY",
          exchange: "NMS",
          exchDisp: "NASDAQ",
        },
      ],
    });
    const r = await fetchYahooSearch("apple");
    expect(r[0]).toMatchObject({
      symbol: "AAPL",
      assetClass: "stock",
      market: "NASDAQ",
    });
  });

  it("CRYPTOCURRENCY → crypto", async () => {
    global.fetch = mockFetchOk({
      quotes: [
        {
          symbol: "BTC-USD",
          shortname: "Bitcoin USD",
          quoteType: "CRYPTOCURRENCY",
          exchange: "CCC",
        },
      ],
    });
    const r = await fetchYahooSearch("bitcoin");
    expect(r[0]).toMatchObject({
      symbol: "BTC-USD",
      assetClass: "crypto",
      market: "CRYPTO",
    });
  });

  it("FUTURE (GC=F gold) → commodity", async () => {
    global.fetch = mockFetchOk({
      quotes: [
        {
          symbol: "GC=F",
          shortname: "Gold Futures",
          quoteType: "FUTURE",
          exchange: "CMX",
        },
      ],
    });
    const r = await fetchYahooSearch("gold");
    expect(r[0]).toMatchObject({
      symbol: "GC=F",
      assetClass: "commodity",
      market: "COMMODITY",
    });
  });

  it(".KS suffix → KRX", async () => {
    global.fetch = mockFetchOk({
      quotes: [
        {
          symbol: "005930.KS",
          shortname: "Samsung Electronics",
          quoteType: "EQUITY",
          exchange: "KSC",
        },
      ],
    });
    const r = await fetchYahooSearch("samsung");
    expect(r[0]).toMatchObject({
      symbol: "005930.KS",
      assetClass: "stock",
      market: "KRX",
    });
  });

  it("공백 쿼리는 빈 결과 + 네트워크 호출 없음", async () => {
    const fetchMock = mockFetchOk({});
    global.fetch = fetchMock;
    const r = await fetchYahooSearch("   ");
    expect(r).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @gons/stock-analysis test`
Expected: 9 PASS 총.

- [ ] **Step 4: fundamentals 케이스**

```ts
describe("fetchYahooFundamentals", () => {
  it("PER/PBR/배당/MA 추출", async () => {
    global.fetch = mockFetchOk({
      quoteResponse: {
        result: [
          {
            symbol: "AAPL",
            marketCap: 3_000_000_000_000,
            trailingPE: 28.5,
            priceToBook: 42.1,
            trailingAnnualDividendYield: 0.005,
            fiftyDayAverage: 175.2,
            twoHundredDayAverage: 165.8,
          },
        ],
        error: null,
      },
    });
    const r = await fetchYahooFundamentals("AAPL");
    expect(r).toMatchObject({
      symbol: "AAPL",
      marketCap: 3_000_000_000_000,
      per: 28.5,
      pbr: 42.1,
      dividendYield: 0.005,
      ma50: 175.2,
      ma200: 165.8,
    });
  });

  it("Yahoo 응답에 result 가 없으면 throw", async () => {
    global.fetch = mockFetchOk({
      quoteResponse: { result: [], error: null },
    });
    await expect(fetchYahooFundamentals("UNKNOWN")).rejects.toThrow(/not found/);
  });
});
```

Run: `pnpm --filter @gons/stock-analysis test`
Expected: 11 PASS 총.

- [ ] **Step 5: Commit**

```bash
git add packages/stock-analysis/tests/yahoo.test.ts
git commit -m "test(stock-analysis): Yahoo adapter unit 테스트 (정상/error/자산군 매핑/empty)"
```

---

## Task 2.5: /api/stock/search route

**Files:**
- Create: `apps/dashboard/src/app/api/stock/search/route.ts`

NextAuth 인증 후 Yahoo search proxy. autocomplete 디바운스는 클라이언트 (Phase 4) 책임.

- [ ] **Step 1: route.ts 작성**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { fetchYahooSearch } from "@gons/stock-analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  if (q.trim().length < 1) {
    return NextResponse.json({ results: [] });
  }
  try {
    const results = await fetchYahooSearch(q);
    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "Yahoo search failed", detail: msg },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/api/stock/search/route.ts
git commit -m "feat(stock-analysis): GET /api/stock/search (Yahoo autocomplete proxy + NextAuth)"
```

---

## Task 2.6: /api/stock/quote route

**Files:**
- Create: `apps/dashboard/src/app/api/stock/quote/route.ts`

배치 시세. 클라이언트가 `?symbols=AAPL,NVDA,BTC-USD` 로 호출.

- [ ] **Step 1: route.ts 작성**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { fetchYahooQuotes } from "@gons/stock-analysis";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 20;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [] });
  }
  try {
    const quotes = await fetchYahooQuotes(symbols);
    return NextResponse.json({ quotes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "Yahoo quote failed", detail: msg },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/api/stock/quote/route.ts
git commit -m "feat(stock-analysis): GET /api/stock/quote (배치 시세 + NextAuth + 20 cap)"
```

---

## Task 2.7: entities/stock 의 placeholder 교체

**Files:**
- Modify: `apps/dashboard/src/entities/stock/model/quote-types.ts`
- Modify: `apps/dashboard/src/entities/stock/server.ts`

Phase 1 의 inline 타입 정의를 package 타입의 re-export 로 단일화 + server placeholder 를 실제 adapter 호출로 교체.

⚠️ **Phase 1 T1.7 fix 후 quote-types.ts 위치 확인:** boundary 위반 해소로 `shared/lib/stock/types.ts` 로 이동된 경우, entities 가 그곳에서 import. 본 task 가 그 path 를 package re-export 로 갱신.

- [ ] **Step 1: 현재 quote-types.ts 위치 grep**

Run: `grep -rn "AssetClass" apps/dashboard/src/entities apps/dashboard/src/shared/lib 2>/dev/null | head -10`
Expected: 현재 타입이 어디에 정의되어 있는지 확인. Phase 1 T1.7 fix 가 shared/lib/stock/types.ts 로 이동했다면 그 파일 수정. 아니라면 entities/stock/model/quote-types.ts 수정.

- [ ] **Step 2: 식별된 파일을 package re-export 로 교체**

기존 inline interface 정의를 모두 삭제하고:

```ts
export type {
  AssetClass,
  Market,
  NormalizedQuote as Quote,
  NormalizedSearchResult as SearchResult,
  NormalizedFundamentals as Fundamentals,
} from "@gons/stock-analysis";
```

⚠️ `Quote` / `SearchResult` 의 다른 import 호출 부 (예: portfolio-holding) 가 이미 동일 shape 라 영향 없음. 단 `Fundamentals` 같은 새 타입은 Phase 1 에는 없었으니 이번에 처음 도입.

- [ ] **Step 3: server.ts placeholder 교체**

```ts
import "server-only";
import {
  fetchYahooQuotes,
  fetchYahooSearch as fetchYahooSearchRaw,
} from "@gons/stock-analysis";
export type {
  Quote,
  SearchResult,
  Fundamentals,
  AssetClass,
  Market,
} from "./model/quote-types";

export async function listMarketQuote(symbols: string[]) {
  return fetchYahooQuotes(symbols);
}

export async function fetchYahooSearch(query: string) {
  return fetchYahooSearchRaw(query);
}
```

⚠️ Phase 1 의 `throw new Error("Phase 2 에서 구현")` 라인이 모두 제거되었는지 grep 확인.

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors.

- [ ] **Step 5: 잔여 placeholder 확인**

Run: `grep -rn "Phase 2 에서 구현" apps/dashboard/src/entities/stock`
Expected: 결과 없음 (모든 placeholder 제거됨).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/entities/stock/
git commit -m "feat(stock-analysis): entities/stock 의 placeholder 를 Yahoo adapter 호출로 교체"
```

---

## Task 2.8: 통합 검증 + PR

- [ ] **Step 1: 전체 typecheck**

Run: `pnpm typecheck`
Expected: 모든 패키지 PASS.

- [ ] **Step 2: 전체 lint**

Run: `pnpm lint`
Expected: PASS.

OOM 회피 (Phase 1 T1.7 우려사항 #2): `NODE_OPTIONS="--max-old-space-size=8192" pnpm lint`

- [ ] **Step 3: 전체 test**

Run: `pnpm test`
Expected: stock-analysis 11 PASS, saju 기존 22 PASS. dashboard 통합 테스트는 TEST_DATABASE_URL 가드로 일부 ECONNREFUSED 가능 (Gotcha #2) — pure unit 만 PASS 면 OK.

- [ ] **Step 4: 작업 commit 목록 검증**

Run: `git log --oneline origin/main..HEAD`
Expected: 7 commit (T2.1~T2.7).

- [ ] **Step 5: branch push 후 PR 생성**

```bash
git push -u origin feat/stock-analysis-phase-2

gh pr create --title "feat(stock-analysis): Phase 2 — Yahoo Finance Adapter" --body "$(cat <<'EOF'
## Summary
- Yahoo Finance unofficial API 어댑터 (quote / fundamentals / OHLC / search)
- 5초 timeout + retry 1회 + UA 헤더 (anti-blocking)
- 자산군 매핑 (stock / crypto / commodity) + 거래소 매핑 (NASDAQ / NYSE / KRX / CRYPTO / COMMODITY)
- /api/stock/search 와 /api/stock/quote route (NextAuth 인증)
- entities/stock/server.ts 의 placeholder 를 실제 어댑터로 교체
- Vitest unit 테스트 11개 (정상 / rate-limit / error / 자산군 매핑 / empty)

## Notes
- Yahoo unofficial — R1 위험 (spec §6.3). adapter 분리로 KIS/Polygon 폴백 가능
- Phase 1 T1.7 우려사항 #2 (lint OOM) 가 재발하면 NODE_OPTIONS 핫픽스 검토

## Spec / Plan
- Spec: docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md
- Plan: docs/superpowers/plans/2026-05-21-stock-analysis-widget/phase-2-yahoo-adapter.md

## Test plan
- [x] pnpm typecheck PASS
- [x] pnpm lint PASS
- [x] pnpm test — stock-analysis 11 PASS
- [ ] (수동) 로컬 dev 띄워서 /api/stock/search?q=apple → 401 (logged out) / 결과 (logged in)

🤖 Generated with Claude Code
EOF
)"
```

---

## Phase 2 self-check

- [ ] `pnpm typecheck && pnpm lint && pnpm test` 모두 PASS
- [ ] 11+ Vitest 테스트
- [ ] `/api/stock/search` 와 `/api/stock/quote` 둘 다 NextAuth 401 가드
- [ ] entities/stock/server.ts 의 `throw new Error("Phase 2 에서 구현")` 완전 제거 (grep 확인)
- [ ] PR 머지 후 main Docker 빌드 success (`gh run watch`)

Phase 2 PR 머지 후 Phase 3 (페르소나 + 합의 빌더) 진입 — Phase 2 의 실제 Yahoo 응답 quirk 가 발견되면 spec §10 의 "Claude Code CLI Proxy 빌링 방식" 등과 함께 phase-3 plan 에 반영.

---

## 횡단 관심사 (Phase 2 갱신)

- **entities/stock 타입 단일 소스화** (T2.7): package 가 source of truth, entities 는 re-export. 다른 컴포넌트가 옛 inline type 을 import 했다면 동일 shape 라 영향 없음.
- **Phase 1 T1.7 boundary fix 후속**: quote-types.ts 가 `shared/lib/stock/types.ts` 로 이동되어 있으면 T2.7 Step 1 의 grep 으로 확인 후 그 파일을 갱신.
- **NODE_OPTIONS lint 핫픽스** (Phase 1 우려): 본 phase scope 밖. 별도 미니 PR 로 분리 검토.
- **Yahoo 응답 변화 모니터링**: 운영 사용 중 schema 변화 발견 시 `yahoo-types.ts` 한 파일 수정으로 흡수. R1 (spec §6.3) 의 첫 방어선.
