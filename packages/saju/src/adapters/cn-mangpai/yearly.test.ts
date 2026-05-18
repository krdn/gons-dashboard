import { describe, expect, it } from "vitest";
import { buildYearlyCnMangpai } from "./yearly";
import { buildYongshinCnMangpai } from "./yongshin";
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

describe("buildYearlyCnMangpai — 2026", () => {
  it("emergence hint 가 schoolSpecificHints 에 포함", () => {
    const r = buildYearlyCnMangpai({
      chart: canonical1967,
      daeun: daeun1967,
      targetYear: 2026,
      yongShin: buildYongshinCnMangpai(canonical1967),
      currentAge: 59,
    });
    expect(r.school).toBe("cn-mangpai");
    expect(r.yearGanji.stem).toBe("丙");
    expect(r.yearGanji.branch).toBe("午");
    expect(r.schoolSpecificHints.emergence).toBeDefined();
    // canonical → 壬日 卯月 同氣 hint
    expect(r.schoolSpecificHints.emergence).toContain("同氣");
  });
});
