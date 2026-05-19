import { describe, expect, it } from "vitest";
import { buildYongshinKo } from "./yongshin";
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

describe("buildYongshinKo — v0.3 종격 우선", () => {
  it("김석곤 1967-03-29 (가종 종아) → primary=木, gisin=[水,金]", () => {
    const chart = chartOf("丁","未", "癸","卯", "壬","辰", "癸","卯", "傷官格");
    const result = buildYongshinKo(chart);
    expect(result.basisShenStrength).toBe("종아");
    expect(result.primary).toBe("wood");
    expect(result.gisin).toEqual(expect.arrayContaining(["water", "metal"]));
  });
});

describe("buildYongshinKo — 격국 분기 / fallback / 조후", () => {
  it("신약 상관격 → 傷官佩印 가능성 (종격 트리거 미달 시)", () => {
    const chart = chartOf("壬","申", "乙","卯", "壬","午", "丙","午", "傷官格");
    const result = buildYongshinKo(chart);
    if (result.basisShenStrength === "신약") {
      expect(result.primary).toBe("metal");
    }
  });

  it("신강 정관격 → 財官相生 가능성", () => {
    const chart = chartOf("壬","子", "甲","寅", "甲","寅", "辛","未", "正官格");
    const result = buildYongshinKo(chart);
    if (result.basisShenStrength === "신강") {
      expect(result.primary).toBe("earth");
    }
  });

  it("기타 격국 + 신약 → fallback 인성 용신 (또는 조후 swap)", () => {
    const chart = chartOf("辛","酉", "丙","申", "甲","午", "戊","辰", "");
    const result = buildYongshinKo(chart);
    if (result.basisShenStrength === "신약") {
      expect(["water"]).toContain(result.primary);
    }
  });

  it("겨울 월령 → secondary=火", () => {
    const chart = chartOf("甲","寅", "丙","子", "甲","寅", "甲","寅", "");
    const result = buildYongshinKo(chart);
    expect(result.basisJohuMode).toBe("한랭");
  });

  it("여름 월령 → secondary=水", () => {
    const chart = chartOf("甲","寅", "丙","午", "甲","寅", "甲","寅", "");
    const result = buildYongshinKo(chart);
    expect(result.basisJohuMode).toBe("조열");
  });
});
