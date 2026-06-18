import { describe, it, expect } from "vitest";
import { compareVerdicts } from "./detect";

describe("compareVerdicts — 순수 flip 판정", () => {
  const base = { symbol: "AAPL" };

  it("verdict 가 다르면 FlipDetection 반환 (BUY→SELL)", () => {
    const result = compareVerdicts({
      ...base,
      yesterday: { verdict: "BUY", promptVersion: "v3" },
      today: { verdict: "SELL", promptVersion: "v3" },
    });
    expect(result).toEqual({ symbol: "AAPL", fromVerdict: "BUY", toVerdict: "SELL" });
  });

  it("verdict 가 동일하면 null (flip 아님)", () => {
    const result = compareVerdicts({
      ...base,
      yesterday: { verdict: "HOLD", promptVersion: "v3" },
      today: { verdict: "HOLD", promptVersion: "v3" },
    });
    expect(result).toBeNull();
  });

  it("promptVersion 불일치면 verdict 가 달라도 null (비교 무의미)", () => {
    const result = compareVerdicts({
      ...base,
      yesterday: { verdict: "BUY", promptVersion: "v2" },
      today: { verdict: "SELL", promptVersion: "v3" },
    });
    expect(result).toBeNull();
  });

  it("HOLD→BUY flip 도 정상 감지", () => {
    const result = compareVerdicts({
      ...base,
      yesterday: { verdict: "HOLD", promptVersion: "v3" },
      today: { verdict: "BUY", promptVersion: "v3" },
    });
    expect(result).toEqual({ symbol: "AAPL", fromVerdict: "HOLD", toVerdict: "BUY" });
  });
});
