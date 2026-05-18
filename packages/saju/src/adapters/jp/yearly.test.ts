import { describe, expect, it } from "vitest";
import { buildYearlyJp } from "./yearly";
import { buildYongshinJp } from "./yongshin";
import type { SajuChart, MajorFortune } from "../../types";

const daeun1967: MajorFortune[] = [
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

describe("buildYearlyJp — 2026", () => {
  it("favorable/unfavorable 통변성 hint 가 schoolSpecificHints 에 포함", () => {
    const r = buildYearlyJp({
      chart: canonical1967,
      daeun: daeun1967,
      targetYear: 2026,
      yongShin: buildYongshinJp(canonical1967),
      currentAge: 59,
    });
    expect(r.school).toBe("jp");
    expect(r.yearGanji.stem).toBe("丙");
    expect(r.yearGanji.branch).toBe("午");
    expect(r.schoolSpecificHints.favorable).toContain("재성");
    expect(r.schoolSpecificHints.unfavorable).toContain("비겁");
    // yongShinDelta 는 항상 빈/mixed (chart 무관 정적 favorable/unfavorable 만)
    expect(r.yongShinDelta.reinforced).toEqual([]);
    expect(r.yongShinDelta.weakened).toEqual([]);
    expect(r.yongShinDelta.netVerdict).toBe("mixed");
  });
});
