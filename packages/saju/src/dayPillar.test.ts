import { describe, expect, it } from "vitest";
import { computeDayPillar } from "./dayPillar";

describe("computeDayPillar", () => {
  it("D1: 2026-05-14 → 戊子", () => {
    expect(computeDayPillar("2026-05-14")).toEqual({ stem: "戊", branch: "子" });
  });

  it("D2: 2026-05-13 → 丁亥 (현행 fortune-data.ts의 戊申은 잘못)", () => {
    expect(computeDayPillar("2026-05-13")).toEqual({ stem: "丁", branch: "亥" });
  });

  it("D3: 2026-05-15 → 己丑", () => {
    expect(computeDayPillar("2026-05-15")).toEqual({ stem: "己", branch: "丑" });
  });
});
