import { describe, it, expect } from "vitest";
import { computeShensha } from "./shensha";
import type { SajuPillars } from "../types";

// 1967-03-29 05:30 — 丁未 / 癸卯 / 壬辰 / 癸卯
const pillars1967: SajuPillars = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
};

describe("computeShensha", () => {
  it("壬辰 일주 → 괴강(魁罡)", () => {
    const result = computeShensha(pillars1967);
    expect(result.some((s) => s.name === "괴강")).toBe(true);
  });

  it("子년 일지·시지 동시 酉 → 도화(桃花) 가중", () => {
    // 子년 → 도화 = 酉 (申子辰 → 패지 酉). day·hour 모두 酉 → 도화 2회 출현으로 "가중" 검증.
    const dohwaChart: SajuPillars = {
      year: { stem: "甲", branch: "子" },
      month: { stem: "丙", branch: "寅" },
      day: { stem: "戊", branch: "酉" },
      hour: { stem: "辛", branch: "酉" },
    };
    const result = computeShensha(dohwaChart);
    expect(result.filter((s) => s.name === "도화").length).toBeGreaterThanOrEqual(2);
  });

  it("천을귀인 없는 사주 → 빈 결과", () => {
    const noCheonEul: SajuPillars = {
      year: { stem: "甲", branch: "子" },
      month: { stem: "丙", branch: "寅" },
      day: { stem: "壬", branch: "辰" },
      hour: { stem: "戊", branch: "申" },
    };
    const result = computeShensha(noCheonEul);
    expect(result.some((s) => s.name === "천을귀인")).toBe(false);
  });
});
