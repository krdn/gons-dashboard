import { describe, expect, it } from "vitest";
import { computeYearPillar, computeYearPillarFromDate } from "./yearPillar";

describe("computeYearPillar", () => {
  it("Y1: 2026 → 丙午", () => {
    expect(computeYearPillar(2026)).toEqual({ stem: "丙", branch: "午" });
  });

  it("Y2: 1967 → 丁未 (G1 사용자)", () => {
    expect(computeYearPillar(1967)).toEqual({ stem: "丁", branch: "未" });
  });

  it("Y3: 2024-06-01 (입춘 후) → 甲辰", () => {
    expect(computeYearPillarFromDate("2024-06-01")).toEqual({ stem: "甲", branch: "辰" });
  });

  it("Y4: 2024-01-15 (입춘 전) → 癸卯 (전년)", () => {
    expect(computeYearPillarFromDate("2024-01-15")).toEqual({ stem: "癸", branch: "卯" });
  });
});
