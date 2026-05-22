import { describe, it, expect } from "vitest";
import { mergeSnapshot } from "./merge-snapshot";
import type {
  NormalizedQuote,
  NormalizedFundamentals,
  DartFinancials,
} from "@gons/stock-analysis";

const baseQuote: NormalizedQuote = {
  symbol: "005930.KS",
  price: 70000,
  changePct: 1.2,
  currency: "KRW",
  fetchedAt: "2026-05-22T08:00:00.000Z",
};

const yahooFund: NormalizedFundamentals = {
  symbol: "005930.KS",
  marketCap: 4_180_000_000_000_000,
  per: 5.5, // Yahoo forwardPE fallback
  pbr: undefined,
  dividendYield: undefined,
};

const dartFund: DartFinancials = {
  krxCode: "005930",
  corpCode: "00126380",
  reportPeriod: "2025-Q3",
  revenueTrailing4Q: 250_000_000_000_000,
  revenueGrowthYoY: 12.3,
  operatingProfitTrailing4Q: 25_000_000_000_000,
  opMarginPct: 10,
  eps: 5000,
  bps: 55000,
  annualDPS: 1470,
  asOf: "2026-05-22",
};

describe("mergeSnapshot", () => {
  it("DART trailing EPS present → per = price/eps (DART 우선)", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, []);
    expect(s.per).toBeCloseTo(70000 / 5000, 4); // 14
    expect(s.fundamentalsSource).toBe("yahoo+dart");
    expect(s.trailingEPS).toBe(5000);
    expect(s.dartReportPeriod).toBe("2025-Q3");
  });

  it("DART BPS present → derivedPBR = price/bps", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, []);
    expect(s.pbr).toBeCloseTo(70000 / 55000, 4); // ~1.27
  });

  it("DART annualDPS present → dividendYield = dps/price * 100", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, []);
    expect(s.dividendYield).toBeCloseTo((1470 / 70000) * 100, 4); // ~2.1
  });

  it("DART null EPS → yahoo forwardPE fallback", () => {
    const dartNoEps: DartFinancials = { ...dartFund, eps: null };
    const s = mergeSnapshot(baseQuote, yahooFund, dartNoEps, []);
    expect(s.per).toBe(5.5);
  });

  it("DART entirely null → fundamentalsSource = yahoo, pbr undefined", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, null, []);
    expect(s.fundamentalsSource).toBe("yahoo");
    expect(s.pbr).toBeUndefined();
    expect(s.dividendYield).toBeUndefined();
    expect(s.per).toBe(5.5);
  });

  it("yahoo + DART both null → fundamentalsSource = none", () => {
    const s = mergeSnapshot(baseQuote, null, null, []);
    expect(s.fundamentalsSource).toBe("none");
    expect(s.per).toBeUndefined();
    expect(s.marketCap).toBeUndefined();
  });

  it("guards against EPS <= 0 (적자) → falls back to yahoo forwardPE", () => {
    const dartNegEps: DartFinancials = { ...dartFund, eps: -1500 };
    const s = mergeSnapshot(baseQuote, yahooFund, dartNegEps, []);
    expect(s.per).toBe(5.5); // DART eps 무시
  });

  it("computes ma20/ma60/rsi14 from closes", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i); // 상승 추세
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, closes);
    expect(s.ma20).toBeGreaterThan(0);
    expect(s.ma60).toBeGreaterThan(0);
    expect(s.rsi14).toBeGreaterThan(50); // 상승 추세 → RSI 50 이상
  });
});
