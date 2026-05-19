import { describe, expect, it } from "vitest";
import { computeElements, computeStrength } from "./elements";

describe("computeElements", () => {
  it("G1: 丁未/癸卯/壬辰/癸卯 → wood:2 fire:1 earth:2 metal:0 water:3", () => {
    // 천간 4: 丁(火) 癸(水) 壬(水) 癸(水) → fire:1, water:3
    // 지지 4: 未(土) 卯(木) 辰(土) 卯(木) → earth:2, wood:2
    // 합: wood:2 fire:1 earth:2 metal:0 water:3 (총 8개)
    const result = computeElements({
      year: { stem: "丁", branch: "未" },
      month: { stem: "癸", branch: "卯" },
      day: { stem: "壬", branch: "辰" },
      hour: { stem: "癸", branch: "卯" },
    });
    expect(result).toEqual({ wood: 2, fire: 1, earth: 2, metal: 0, water: 3 });
  });

  it("hour null이면 6자만 카운트 합 = 6", () => {
    const result = computeElements({
      year: { stem: "甲", branch: "子" },
      month: { stem: "乙", branch: "丑" },
      day: { stem: "丙", branch: "寅" },
      hour: null,
    });
    const total = result.wood + result.fire + result.earth + result.metal + result.water;
    expect(total).toBe(6);
  });
});

describe("computeStrength", () => {
  it("G1: 일간 壬(水), 水 카운트 3 / 총 8 = 37.5% → 균형", () => {
    // 3/8 = 37.5% → 0.25 이상 0.4 미만 → 균형
    expect(computeStrength({ wood: 2, fire: 1, earth: 2, metal: 0, water: 3 }, "壬")).toBe("균형");
  });

  it("일간 오행 4개 / 총 8 = 50% → 신강", () => {
    // 4/8 = 50% → 0.4 이상 → 신강
    expect(computeStrength({ wood: 0, fire: 4, earth: 2, metal: 1, water: 1 }, "丁")).toBe("신강");
  });

  it("일간 오행 0개 / 총 8 = 0% → 신약", () => {
    // 0/8 = 0% → 0.25 미만 → 신약
    expect(computeStrength({ wood: 2, fire: 0, earth: 3, metal: 2, water: 1 }, "丁")).toBe("신약");
  });

  it("일간 오행 2개 / 총 8 = 25% → 균형", () => {
    // 2/8 = 25% → 0.25 이상 0.4 미만 → 균형
    expect(computeStrength({ wood: 2, fire: 2, earth: 2, metal: 1, water: 1 }, "甲")).toBe("균형");
  });

  it("일간 오행 1개 / 총 8 = 12.5% → 신약", () => {
    // 1/8 = 12.5% → 0.25 미만 → 신약
    expect(computeStrength({ wood: 1, fire: 2, earth: 2, metal: 2, water: 1 }, "甲")).toBe("신약");
  });
});
