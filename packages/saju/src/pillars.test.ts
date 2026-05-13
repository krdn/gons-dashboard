import { describe, expect, it } from "vitest";
import { computePillars } from "./pillars";

describe("computePillars", () => {
  it("G1: 1967-03-29 05:30 양력 → 丁未/癸卯/壬辰/癸卯", () => {
    const result = computePillars({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
    });
    expect(result.year).toEqual({ stem: "丁", branch: "未" });
    expect(result.month).toEqual({ stem: "癸", branch: "卯" });
    expect(result.day).toEqual({ stem: "壬", branch: "辰" });
    expect(result.hour).toEqual({ stem: "癸", branch: "卯" });
  });

  it("G2: 출생시 모름 → hour null", () => {
    const result = computePillars({
      birthDate: "1990-01-15",
      birthTime: null,
      calendar: "solar",
    });
    expect(result.hour).toBeNull();
    expect(result.year.stem).toBeDefined();
    expect(result.year.branch).toBeDefined();
  });

  it("G3: 절기 경계 — 2024-02-04 17:00 입춘 후 → 甲辰년/丙寅월/戊戌일", () => {
    const result = computePillars({
      birthDate: "2024-02-04",
      birthTime: "17:00",
      calendar: "solar",
    });
    expect(result.year).toEqual({ stem: "甲", branch: "辰" });
    expect(result.month).toEqual({ stem: "丙", branch: "寅" });
    expect(result.day).toEqual({ stem: "戊", branch: "戌" });
  });

  it("음력 입력 → 양력 변환 후 정상 계산", () => {
    // 음력 1967-02-19 = 양력 1967-03-29
    const lunarResult = computePillars({
      birthDate: "1967-02-19",
      birthTime: "05:30",
      calendar: "lunar",
    });
    const solarResult = computePillars({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
    });
    expect(lunarResult).toEqual(solarResult);
  });
});
