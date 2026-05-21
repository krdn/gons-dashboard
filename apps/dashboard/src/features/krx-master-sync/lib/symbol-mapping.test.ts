import { describe, it, expect } from "vitest";
import { toYahooSymbol, inferSecurityType } from "./symbol-mapping";

describe("toYahooSymbol", () => {
  it("KOSPI → .KS", () => {
    expect(toYahooSymbol("005930", "KOSPI")).toBe("005930.KS");
  });
  it("KOSDAQ → .KQ", () => {
    expect(toYahooSymbol("036930", "KOSDAQ")).toBe("036930.KQ");
  });
});

describe("inferSecurityType", () => {
  it("종목명에 ETF 키워드 포함 → ETF", () => {
    expect(inferSecurityType("KODEX 200")).toBe("ETF");
    expect(inferSecurityType("TIGER 미국S&P500")).toBe("ETF");
    expect(inferSecurityType("ARIRANG 코스피")).toBe("ETF");
  });
  it("리츠 → REIT", () => {
    expect(inferSecurityType("롯데리츠")).toBe("REIT");
    expect(inferSecurityType("이지스밸류리츠")).toBe("REIT");
  });
  it("ETN 키워드 → ETN", () => {
    expect(inferSecurityType("신한 코스피200 ETN")).toBe("ETN");
  });
  it("스팩 → SPAC", () => {
    expect(inferSecurityType("미래에셋스팩4호")).toBe("SPAC");
  });
  it("일반 종목 → EQUITY", () => {
    expect(inferSecurityType("삼성전자")).toBe("EQUITY");
    expect(inferSecurityType("주성엔지니어링")).toBe("EQUITY");
  });
});
