import { describe, expect, it } from "vitest";
import { verifyConsensus } from "./index";

describe("verifyConsensus — lunar-javascript vs korean-lunar-calendar", () => {
  it("1967-03-29 → 양쪽 모두 일주 壬 합의", () => {
    const result = verifyConsensus({ birthDateLocal: "1967-03-29", calendar: "solar" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dayPillar.stem).toBe("壬");
  });

  it("함수 export 확인 (sanity)", () => {
    expect(typeof verifyConsensus).toBe("function");
  });

  it("lunar input은 throw — 미지원 명시", () => {
    expect(() =>
      verifyConsensus({ birthDateLocal: "1967-03-29", calendar: "lunar" }),
    ).toThrow("lunar input not yet supported");
  });
});
