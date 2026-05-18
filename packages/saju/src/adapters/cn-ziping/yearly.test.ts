import { describe, expect, it } from "vitest";
import { buildYearlyCnZiping } from "./yearly";
import { buildYongshinCnZiping } from "./yongshin";
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

describe("buildYearlyCnZiping — 2026", () => {
  it("2026 = 丙午, 대운 丁酉, structure hint 가 schoolSpecificHints 에 포함", () => {
    const r = buildYearlyCnZiping({
      chart: canonical1967,
      daeun: daeun1967,
      targetYear: 2026,
      yongShin: buildYongshinCnZiping(canonical1967),
      currentAge: 59,
    });
    expect(r.school).toBe("cn-ziping");
    expect(r.yearGanji.stem).toBe("丙");
    expect(r.yearGanji.branch).toBe("午");
    expect(r.currentDaeun.ganji.stem).toBe("丁");
    expect(r.schoolSpecificHints.structure).toBeDefined();
    // canonical fixture → CN자평 신약, structureHint = "기타" (관성/인성 카운트 부족)
    expect(r.schoolSpecificHints.structure).toBe("기타");
  });
});
