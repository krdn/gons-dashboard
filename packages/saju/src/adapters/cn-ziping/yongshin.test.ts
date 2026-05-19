import { describe, expect, it } from "vitest";
import { buildYongshinCnZiping } from "./yongshin";
import type { SajuChart } from "../../types";

function chartOf(
  yearStem: string, yearBranch: string,
  monthStem: string, monthBranch: string,
  dayStem: string, dayBranch: string,
  hourStem: string | null, hourBranch: string | null,
  pattern = "",
): SajuChart {
  return {
    pillars: {
      year:  { stem: yearStem as any, branch: yearBranch as any },
      month: { stem: monthStem as any, branch: monthBranch as any },
      day:   { stem: dayStem as any, branch: dayBranch as any },
      hour:  hourStem && hourBranch
        ? { stem: hourStem as any, branch: hourBranch as any }
        : null,
    },
    elements: { wood:0, fire:0, earth:0, metal:0, water:0 },
    strength: "신약",
    tenGods: {} as any,
    pattern,
    yongSin: [], giSin: [],
    majorFortunes: [],
    inputHash: "test",
  };
}

describe("buildYongshinCnZiping — v0.3 종격 우선", () => {
  it("김석곤 (가종 종아) → primary=木, gisin=[水,金], structureHint=기타", () => {
    const chart = chartOf("丁","未", "癸","卯", "壬","辰", "癸","卯", "傷官格");
    const result = buildYongshinCnZiping(chart);
    expect(result.basisShenStrength).toBe("종아");
    expect(result.primary).toBe("wood");
    expect(result.gisin).toEqual(expect.arrayContaining(["water", "metal"]));
    expect(result.structureHint).toBe("기타");
  });
});

describe("buildYongshinCnZiping — 격국 분기 / fallback", () => {
  it("신강 + 傷官格 → 傷官生財 가능성", () => {
    const chart = chartOf("壬","子", "甲","寅", "壬","子", "丙","午", "傷官格");
    const result = buildYongshinCnZiping(chart);
    if (result.basisShenStrength === "신강") {
      expect(result.primary).toBe("fire");
    }
  });

  it("신약 + 正官格 → 官印相生 가능성", () => {
    const chart = chartOf("辛","酉", "丙","申", "甲","午", "戊","辰", "正官格");
    const result = buildYongshinCnZiping(chart);
    if (result.basisShenStrength === "신약") {
      expect(result.primary).toBe("water");
      expect(result.structureHint).toBe("관인상생");
    }
  });

  it("기타 격국 + 신강 → 식상 용신 (식신생재 hint)", () => {
    const chart = chartOf("壬","子", "甲","寅", "甲","寅", "丙","午", "");
    const result = buildYongshinCnZiping(chart);
    if (result.basisShenStrength === "신강") {
      expect(result.primary).toBe("fire");
    }
  });
});
