// Yahoo 어댑터 (yahoo-finance2 v3) 테스트.
// yahoo-finance2 client 의 메서드를 vi.spyOn 으로 mock — raw fetch mock 아님.

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooDailyOHLC,
  fetchYahooSearch,
  YahooFetchError,
} from "../src";
import { getYahooClient } from "../src/adapters/yahoo-finance2-client";
import { isHangul, searchKrxSymbols } from "../src/adapters/krx-symbols";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchYahooQuotes", () => {
  it("정상: 1 종목 quote 를 normalize 한다", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "quote").mockResolvedValue({
      symbol: "AAPL",
      regularMarketPrice: 180.5,
      regularMarketChangePercent: 1.2,
      currency: "USD",
    } as unknown as Awaited<ReturnType<typeof yf.quote>>);
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
    const yf = getYahooClient();
    const spy = vi.spyOn(yf, "quote");
    const result = await fetchYahooQuotes([]);
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("모든 symbol 호출이 실패하면 YahooFetchError throw", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "quote").mockRejectedValue(new Error("network down"));
    await expect(fetchYahooQuotes(["AAPL", "MSFT"])).rejects.toThrow(
      YahooFetchError,
    );
  });

  it("일부만 실패하면 성공한 것만 반환 (Promise.allSettled)", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "quote").mockImplementation((async (s: string | string[]) => {
      if (s === "FAIL") throw new Error("not found");
      return {
        symbol: s as string,
        regularMarketPrice: 100,
        regularMarketChangePercent: 0,
        currency: "USD",
      };
    }) as unknown as typeof yf.quote);
    const result = await fetchYahooQuotes(["AAPL", "FAIL", "MSFT"]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });
});

describe("fetchYahooFundamentals", () => {
  it("PER (trailingPE) 우선 + 기타 필드 매핑", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "quoteSummary").mockResolvedValue({
      price: { symbol: "AAPL", marketCap: 3_000_000_000_000 },
      summaryDetail: {
        trailingPE: 28.5,
        trailingAnnualDividendYield: 0.005,
        fiftyDayAverage: 175.2,
        twoHundredDayAverage: 165.8,
      },
      defaultKeyStatistics: {
        priceToBook: 42.1,
        forwardPE: 26.0,
      },
    } as unknown as Awaited<ReturnType<typeof yf.quoteSummary>>);
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

  it("trailingPE 없으면 forwardPE 폴백 (KR 종목 케이스)", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "quoteSummary").mockResolvedValue({
      price: { symbol: "005930.KS", marketCap: 1_920_000_000_000_000 },
      summaryDetail: {
        dividendYield: 0.005,
      },
      defaultKeyStatistics: {
        forwardPE: 5.56,
      },
    } as unknown as Awaited<ReturnType<typeof yf.quoteSummary>>);
    const r = await fetchYahooFundamentals("005930.KS");
    expect(r.per).toBe(5.56);
    expect(r.dividendYield).toBe(0.005);
    expect(r.marketCap).toBe(1_920_000_000_000_000);
  });

  it("모든 펀더멘털 필드가 missing 이면 모두 undefined", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "quoteSummary").mockResolvedValue({
      price: { symbol: "EMPTY" },
      summaryDetail: {},
      defaultKeyStatistics: {},
    } as unknown as Awaited<ReturnType<typeof yf.quoteSummary>>);
    const r = await fetchYahooFundamentals("EMPTY");
    expect(r).toEqual({
      symbol: "EMPTY",
      marketCap: undefined,
      per: undefined,
      pbr: undefined,
      dividendYield: undefined,
      ma50: undefined,
      ma200: undefined,
    });
  });
});

describe("fetchYahooDailyOHLC", () => {
  it("chart() 응답을 close > 0 만 normalize", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "chart").mockResolvedValue({
      quotes: [
        { date: new Date("2026-04-01"), close: 180.0, volume: 50_000_000 },
        { date: new Date("2026-04-02"), close: 0, volume: 0 },
        { date: new Date("2026-04-03"), close: 181.5, volume: 48_000_000 },
      ],
    } as unknown as Awaited<ReturnType<typeof yf.chart>>);
    const r = await fetchYahooDailyOHLC("AAPL", "1mo");
    expect(r).toEqual([
      { date: "2026-04-01", close: 180.0, volume: 50_000_000 },
      { date: "2026-04-03", close: 181.5, volume: 48_000_000 },
    ]);
  });
});

describe("fetchYahooSearch — 자산군 매핑", () => {
  it("EQUITY + exchange NMS → NASDAQ stock", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "search").mockResolvedValue({
      quotes: [
        {
          symbol: "AAPL",
          longname: "Apple Inc.",
          quoteType: "EQUITY",
          exchange: "NMS",
          exchDisp: "NASDAQ",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof yf.search>>);
    const r = await fetchYahooSearch("apple");
    expect(r[0]).toMatchObject({
      symbol: "AAPL",
      assetClass: "stock",
      market: "NASDAQ",
    });
  });

  it("CRYPTOCURRENCY → crypto", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "search").mockResolvedValue({
      quotes: [
        {
          symbol: "BTC-USD",
          shortname: "Bitcoin USD",
          quoteType: "CRYPTOCURRENCY",
          exchange: "CCC",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof yf.search>>);
    const r = await fetchYahooSearch("bitcoin");
    expect(r[0]).toMatchObject({
      symbol: "BTC-USD",
      assetClass: "crypto",
      market: "CRYPTO",
    });
  });

  it("FUTURE (GC=F gold) → commodity", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "search").mockResolvedValue({
      quotes: [
        {
          symbol: "GC=F",
          shortname: "Gold Futures",
          quoteType: "FUTURE",
          exchange: "CMX",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof yf.search>>);
    const r = await fetchYahooSearch("gold");
    expect(r[0]).toMatchObject({
      symbol: "GC=F",
      assetClass: "commodity",
      market: "COMMODITY",
    });
  });

  it(".KS suffix → KRX", async () => {
    const yf = getYahooClient();
    vi.spyOn(yf, "search").mockResolvedValue({
      quotes: [
        {
          symbol: "005930.KS",
          shortname: "Samsung Electronics",
          quoteType: "EQUITY",
          exchange: "KSC",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof yf.search>>);
    const r = await fetchYahooSearch("samsung");
    expect(r[0]).toMatchObject({
      symbol: "005930.KS",
      assetClass: "stock",
      market: "KRX",
    });
  });

  it("공백 쿼리는 빈 결과 + 네트워크 호출 없음", async () => {
    const yf = getYahooClient();
    const spy = vi.spyOn(yf, "search");
    const r = await fetchYahooSearch("   ");
    expect(r).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
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
    const yf = getYahooClient();
    const spy = vi.spyOn(yf, "search");
    const r = await fetchYahooSearch("삼성전자");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].assetClass).toBe("stock");
    expect(r[0].market).toBe("KRX");
    expect(spy).not.toHaveBeenCalled();
  });
});
