import { describe, expect, it } from "vitest";
import { computePattern } from "./pattern";

describe("computePattern", () => {
  it("G1: 일간 壬, 월지 卯(乙木→傷官), 강약 strong → 傷官格 + 용신 [fire, earth] (재·관)", () => {
    const result = computePattern({
      pillars: {
        year: { stem: "丁", branch: "未" },
        month: { stem: "癸", branch: "卯" },
        day: { stem: "壬", branch: "辰" },
        hour: { stem: "癸", branch: "卯" },
      },
      strength: "strong",
    });
    expect(result.pattern).toBe("傷官格");
    // 신강이면 일간을 제·설하는 오행: 재(壬水→克火) + 관(土克壬水)
    expect(result.yongSin).toContain("fire");
    expect(result.yongSin).toContain("earth");
  });
});
