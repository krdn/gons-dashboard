import { describe, expect, it } from "vitest";
import { computeMonthPillars } from "./monthPillars";

describe("computeMonthPillars", () => {
  it("M1: 2026 12개월 — 라이브러리 검증된 정확한 매핑", () => {
    const r = computeMonthPillars(2026);
    expect(r).toHaveLength(12);
    expect(r[0].pillar).toEqual({ stem: "己", branch: "丑" });   // 1월
    expect(r[1].pillar).toEqual({ stem: "庚", branch: "寅" });   // 2월
    expect(r[2].pillar).toEqual({ stem: "辛", branch: "卯" });   // 3월
    expect(r[3].pillar).toEqual({ stem: "壬", branch: "辰" });   // 4월
    expect(r[4].pillar).toEqual({ stem: "癸", branch: "巳" });   // 5월
    expect(r[5].pillar).toEqual({ stem: "甲", branch: "午" });   // 6월
    expect(r[6].pillar).toEqual({ stem: "乙", branch: "未" });   // 7월
    expect(r[7].pillar).toEqual({ stem: "丙", branch: "申" });   // 8월
    expect(r[8].pillar).toEqual({ stem: "丁", branch: "酉" });   // 9월
    expect(r[9].pillar).toEqual({ stem: "戊", branch: "戌" });   // 10월
    expect(r[10].pillar).toEqual({ stem: "己", branch: "亥" });  // 11월
    expect(r[11].pillar).toEqual({ stem: "庚", branch: "子" });  // 12월
  });

  it("monthIndex는 1..12", () => {
    const r = computeMonthPillars(2026);
    expect(r.map((m) => m.monthIndex)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
  });

  it("startSolarDate는 YYYY-MM-15 형식", () => {
    const r = computeMonthPillars(2026);
    expect(r[4].startSolarDate).toBe("2026-05-15");
  });
});
