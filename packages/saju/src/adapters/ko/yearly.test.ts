import { describe, expect, it } from "vitest";
import { buildYearlyKo } from "./yearly";
import { buildYongshinKo } from "./yongshin";
import type { SajuChart, MajorFortune } from "../../types";

// 1967-03-29 출생. startAge 8 → 1967+8=1975 입대운. 마지막은 78세.
// MajorFortune 실제 type: { startAge, startYear, stem, branch } (endAge 없음).
const daeun1967: MajorFortune[] = [
  { startAge: 8,  startYear: 1975, stem: "壬", branch: "寅" },
  { startAge: 18, startYear: 1985, stem: "辛", branch: "丑" },
  { startAge: 28, startYear: 1995, stem: "庚", branch: "子" },
  { startAge: 38, startYear: 2005, stem: "己", branch: "亥" },
  { startAge: 48, startYear: 2015, stem: "戊", branch: "戌" },
  { startAge: 58, startYear: 2025, stem: "丁", branch: "酉" },
  { startAge: 68, startYear: 2035, stem: "丙", branch: "申" },
];

const canonical1967 = {
  pillars: {
    year: { stem: "丁", branch: "未" },
    month: { stem: "癸", branch: "卯" },
    day: { stem: "壬", branch: "辰" },
    hour: { stem: "癸", branch: "卯" },
  },
  majorFortunes: daeun1967,
} as unknown as SajuChart;

describe("buildYearlyKo — 2026 세군", () => {
  it("2026 = 丙午, 만 59세 → 대운 丁酉 + yongShinDelta 포함", () => {
    const yongShin = buildYongshinKo(canonical1967);
    const result = buildYearlyKo({
      chart: canonical1967,
      daeun: daeun1967,
      targetYear: 2026,
      yongShin,
      currentAge: 59,
    });
    expect(result.school).toBe("ko");
    expect(result.targetYear).toBe(2026);
    expect(result.yearGanji.stem).toBe("丙");
    expect(result.yearGanji.branch).toBe("午");
    // 대운 58~67 = 丁酉
    expect(result.currentDaeun.ganji.stem).toBe("丁");
    expect(result.currentDaeun.ganji.branch).toBe("酉");
    expect(result.currentDaeun.startAge).toBe(58);
    expect(result.currentDaeun.endAge).toBe(67);
    // 午未 합: 원국에 未 (年支) 있음 → 합 1건 이상.
    expect(result.ganjiInteractions.some((i) => i.type === "합")).toBe(true);
    expect(result.yongShinDelta.netVerdict).toMatch(/favorable|unfavorable|mixed/);
  });
});
