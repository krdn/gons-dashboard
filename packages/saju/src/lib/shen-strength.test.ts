import { describe, expect, it } from "vitest";
import { computeShenStrength } from "./shen-strength";
import type { SajuChart } from "../types";

function chartOf(
  yearStem: string, yearBranch: string,
  monthStem: string, monthBranch: string,
  dayStem: string, dayBranch: string,
  hourStem: string | null, hourBranch: string | null,
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
    elements: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
    strength: "신약",
    tenGods: {} as any,
    pattern: "",
    yongSin: [],
    giSin: [],
    majorFortunes: [],
    inputHash: "test",
  };
}

describe("computeShenStrength — 김석곤 가종 종아", () => {
  it("1967-03-29 명조 (丁未·癸卯·壬辰·癸卯) → 가종 종아", () => {
    const chart = chartOf("丁","未", "癸","卯", "壬","辰", "癸","卯");
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("종아");
    expect(result.jonggyeokKind).toBe("가종");
    expect(result.jonggyeokRole).toBe("식상");
  });
});

describe("computeShenStrength — 완전종 케이스", () => {
  it("완전 종아 (인성=0, 비겁=0, 식상 압도)", () => {
    const chart = chartOf("戊","午", "丙","午", "甲","午", "丙","午");
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("종아");
    expect(result.jonggyeokKind).toBe("완전종");
  });

  it("완전 종재 — 일간 戊土, 재성=水 (壬子·癸亥·戊子·癸亥)", () => {
    // advisor 대체: 子(癸)·亥(壬·甲) 의 지장간이 인성=火 만들지 않음
    const chart = chartOf("壬","子", "癸","亥", "戊","子", "癸","亥");
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("종재");
    expect(result.jonggyeokKind).toBe("완전종");
  });

  it("완전 종살 — 일간 甲木, 관성=金 (庚酉·辛酉·甲酉·辛酉)", () => {
    // advisor 대체: 酉(辛) 단일 장간, 인성=水 leak 없음
    const chart = chartOf("庚","酉", "辛","酉", "甲","酉", "辛","酉");
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("종살");
    expect(result.jonggyeokKind).toBe("완전종");
  });
});

describe("computeShenStrength — 일반 신강/신약/균형", () => {
  it("일반 신강 (비겁+인성 우세)", () => {
    const chart = chartOf("壬","子", "甲","寅", "甲","寅", "壬","子");
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("신강");
    expect(result.jonggyeokKind).toBeNull();
  });

  it("일반 신약 (drain 우세, 종격 트리거 미달)", () => {
    const chart = chartOf("甲","午", "戊","辰", "甲","申", "庚","戌");
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("신약");
    expect(result.jonggyeokKind).toBeNull();
  });

  it("균형 (support ≈ drain)", () => {
    const chart = chartOf("壬","寅", "甲","辰", "甲","午", "戊","申");
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("균형");
    expect(result.jonggyeokKind).toBeNull();
  });
});

describe("computeShenStrength — 가종 경계 + 트리거 fail", () => {
  it("가종 경계 (인성=1, dominant=4) → 가종 통과", () => {
    const chart = chartOf("庚","卯", "甲","卯", "壬","寅", "乙","卯");
    const result = computeShenStrength(chart);
    expect(result.jonggyeokKind).toBe("가종");
    expect(result.verdict).toBe("종아");
  });

  it("트리거 fail — 인성 2개 (≤1 위반)", () => {
    const chart = chartOf("壬","子", "甲","午", "甲","午", "丙","午");
    const result = computeShenStrength(chart);
    expect(result.jonggyeokKind).toBeNull();
  });

  it("트리거 fail — dominant < dayHelper × 1.3", () => {
    const chart = chartOf("壬","寅", "甲","寅", "甲","午", "丙","午");
    const result = computeShenStrength(chart);
    expect(result.jonggyeokKind).toBeNull();
  });
});

describe("computeShenStrength — hour 없음 (시주 미상)", () => {
  it("hour=null 정상 처리 (신강 케이스)", () => {
    // year 壬子 + month 甲寅 + day 甲寅, hour=null. 일간 甲. 7 positions only.
    // stem: 壬(인성水), 甲(비겁木), 甲(비겁). branch: 子(인성), 寅(비겁), 寅(비겁).
    // = 비겁 4 + 인성 2 = support 6, drain 0. diff +6 ≥ 2 → 신강
    const chart = chartOf("壬","子", "甲","寅", "甲","寅", null, null);
    const result = computeShenStrength(chart);
    expect(result.verdict).toBe("신강");
    expect(result.jonggyeokKind).toBeNull();
  });
});
