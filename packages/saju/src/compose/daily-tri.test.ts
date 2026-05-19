import { describe, expect, it } from "vitest";
import { buildTriNationDailyLite } from "./daily-tri";
import type { SajuChart } from "../types";

// 1967-03-29 05:30 — G1 일주 (壬辰) 골든 (메모리 참조: saju-G1-day-pillar-correction)
const canonical1967: SajuChart = {
  pillars: {
    year: { stem: "丁", branch: "未" },
    month: { stem: "癸", branch: "卯" },
    day: { stem: "壬", branch: "辰" },
    hour: { stem: "癸", branch: "卯" },
  },
  elements: { wood: 2, fire: 1, earth: 1, metal: 0, water: 4 },
  strength: "신강",
  tenGods: {
    yearStem: "正財",
    yearBranch: "正官",
    monthStem: "劫財",
    monthBranch: "傷官",
    dayBranch: "偏官",
    hourStem: "劫財",
    hourBranch: "傷官",
  },
  pattern: "傷官格",
  yongSin: ["earth", "fire"],
  giSin: ["water", "metal"],
  majorFortunes: [
    { startAge: 8, startYear: 1975, stem: "壬", branch: "寅" },
    { startAge: 18, startYear: 1985, stem: "辛", branch: "丑" },
    { startAge: 28, startYear: 1995, stem: "庚", branch: "子" },
    { startAge: 38, startYear: 2005, stem: "己", branch: "亥" },
    { startAge: 48, startYear: 2015, stem: "戊", branch: "戌" },
    { startAge: 58, startYear: 2025, stem: "丁", branch: "酉" },
  ],
  inputHash: "test-hash-canonical-1967",
};

describe("buildTriNationDailyLite — 2026-05-19", () => {
  it("4학파 frame 모두 생성 + overallVibe 평가", () => {
    const t = buildTriNationDailyLite({
      chart: canonical1967,
      forDate: "2026-05-19",
    });
    expect(t.forDate).toBe("2026-05-19");
    expect(t.frames.ko.school).toBe("ko");
    expect(t.frames.cnZiping.school).toBe("cn-ziping");
    expect(t.frames.cnMangpai.school).toBe("cn-mangpai");
    expect(t.frames.jp.school).toBe("jp");
    expect(["auspicious", "inauspicious", "neutral"]).toContain(t.overallVibe);
  });

  it("dayGanji 가 결정형 (같은 forDate 재호출 시 동일 stem/branch)", () => {
    const t1 = buildTriNationDailyLite({
      chart: canonical1967,
      forDate: "2026-05-19",
    });
    const t2 = buildTriNationDailyLite({
      chart: canonical1967,
      forDate: "2026-05-19",
    });
    expect(t1.frames.ko.dayGanji).toEqual(t2.frames.ko.dayGanji);
    expect(t1.frames.cnZiping.dayGanji).toEqual(t2.frames.cnZiping.dayGanji);
    expect(t1.frames.cnMangpai.dayGanji).toEqual(t2.frames.cnMangpai.dayGanji);
    expect(t1.frames.jp.dayGanji).toEqual(t2.frames.jp.dayGanji);
    // 같은 날짜는 학파 무관 dayGanji 동일
    expect(t1.frames.ko.dayGanji).toEqual(t1.frames.jp.dayGanji);
  });

  it("JP frame — dayVibe 는 항상 neutral, hints 에 favorable/unfavorable 노출", () => {
    const t = buildTriNationDailyLite({
      chart: canonical1967,
      forDate: "2026-05-19",
    });
    expect(t.frames.jp.dayVibe).toBe("neutral");
    expect(t.frames.jp.hints.some((h) => h.startsWith("유리 통변성:"))).toBe(true);
    expect(t.frames.jp.hints.some((h) => h.startsWith("불리 통변성:"))).toBe(true);
  });

  it("KO frame — hints 에 조후 기준 노출 (basisJohuMode)", () => {
    const t = buildTriNationDailyLite({
      chart: canonical1967,
      forDate: "2026-05-19",
    });
    expect(t.frames.ko.hints.some((h) => h.startsWith("조후 기준:"))).toBe(true);
  });
});
