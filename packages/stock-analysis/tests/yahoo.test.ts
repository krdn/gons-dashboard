import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooSearch,
  YahooFetchError,
} from "../src";
import {
  isHangul,
  searchKrxSymbols,
} from "../src/adapters/krx-symbols";

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

describe("fetchYahooQuotes — error paths", () => {
  it("429 rate-limit 은 재시도 후 throw (v8 chart 폴백도 같은 mock 에서 실패)", async () => {
    vi.useFakeTimers();
    // v7 quote 와 v8 chart 폴백 모두 같은 429 mock 을 받음 → 최종 throw.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: vi.fn(),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const promise = fetchYahooQuotes(["AAPL"]);
    const assertion = expect(promise).rejects.toThrow(YahooFetchError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalled();
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

describe("isHangul / searchKrxSymbols", () => {
  it("isHangul: 한글 포함 감지", () => {
    expect(isHangul("삼성전자")).toBe(true);
    expect(isHangul("AAPL")).toBe(false);
    expect(isHangul("AAPL삼성")).toBe(true);
    expect(isHangul("")).toBe(false);
    expect(isHangul("005930.KS")).toBe(false);
  });

  it("searchKrxSymbols: 정확한 종목명 → 단일 매칭", () => {
    const r = searchKrxSymbols("삼성전자");
    expect(r.some((x) => x.symbol === "005930.KS")).toBe(true);
    // 우선주 (005935.KS) 도 substring 으로 같이 잡힘.
    expect(r.some((x) => x.symbol === "005935.KS")).toBe(true);
  });

  it("searchKrxSymbols: '(주)' 정규화", () => {
    const r = searchKrxSymbols("(주)삼성전자");
    expect(r.some((x) => x.symbol === "005930.KS")).toBe(true);
  });

  it("searchKrxSymbols: 매칭 안 되면 빈 배열", () => {
    expect(searchKrxSymbols("존재하지않는종목XYZ")).toEqual([]);
  });
});

describe("fetchYahooSearch — 한글 분기 (로컬 폴백)", () => {
  it("한글 쿼리는 네트워크 호출 없이 로컬 맵에서 결과 반환", async () => {
    const fetchMock = mockFetchOk({});
    global.fetch = fetchMock;
    const r = await fetchYahooSearch("삼성전자");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].assetClass).toBe("stock");
    expect(r[0].market).toBe("KRX");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchYahooQuotes — v8 chart 폴백", () => {
  it("v7 Unauthorized → v8 chart meta 로 폴백하여 price/changePct 반환", async () => {
    const fetchMock = vi
      .fn()
      // 1st: v7 quote → Unauthorized
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: vi.fn().mockResolvedValue({
          quoteResponse: {
            result: [],
            error: { code: "Unauthorized", description: "Invalid Crumb" },
          },
        }),
      } as unknown as Response)
      // 2nd: v8 chart → meta 응답
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: vi.fn().mockResolvedValue({
          chart: {
            result: [
              {
                meta: {
                  symbol: "AAPL",
                  regularMarketPrice: 180,
                  currency: "USD",
                  chartPreviousClose: 178,
                },
                timestamp: [],
                indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] },
              },
            ],
            error: null,
          },
        }),
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await fetchYahooQuotes(["AAPL"]);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("AAPL");
    expect(result[0].price).toBe(180);
    // changePct = (180 - 178) / 178 * 100 ≈ 1.1236
    expect(result[0].changePct).toBeCloseTo(1.1236, 3);
    expect(result[0].currency).toBe("USD");
  });
});
