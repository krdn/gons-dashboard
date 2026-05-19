import { describe, expect, it } from "vitest";
import { buildGyeokgukYongshin } from "./gyeokguk-yongshin";
import type { ShenStrengthResult } from "./shen-strength";
import type { SajuChart } from "../types";

function chartWith(dayStem: string): SajuChart {
  return {
    pillars: {
      year: { stem: "甲" as any, branch: "子" as any },
      month: { stem: "甲" as any, branch: "子" as any },
      day: { stem: dayStem as any, branch: "子" as any },
      hour: null,
    },
    elements: { wood:0, fire:0, earth:0, metal:0, water:0 },
    strength: "신약",
    tenGods: {} as any,
    pattern: "",
    yongSin: [], giSin: [],
    majorFortunes: [],
    inputHash: "test",
  };
}

function shenOf(verdict: "신강" | "신약" | "종아"): ShenStrengthResult {
  return {
    dayElement: "water",
    supportScore: 0, drainScore: 0,
    roleCount: { 비겁:0, 인성:0, 식상:0, 재성:0, 관성:0 },
    roleCountExtended: { 비겁:0, 인성:0, 식상:0, 재성:0, 관성:0 },
    verdict,
    jonggyeokKind: verdict === "종아" ? "가종" : null,
    jonggyeokRole: verdict === "종아" ? "식상" : null,
  };
}

describe("buildGyeokgukYongshin — 상관격", () => {
  it("신강 + 傷官格 → 傷官生財 (재성 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신강"), "傷官格");
    expect(result!.pattern).toBe("傷官生財");
    expect(result!.primary).toBe("fire");
  });

  it("신약 + 傷官格 → 傷官佩印 (인성 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신약"), "傷官格");
    expect(result!.pattern).toBe("傷官佩印");
    expect(result!.primary).toBe("metal");
  });
});

describe("buildGyeokgukYongshin — 정관격", () => {
  it("신강 + 正官格 → 財官相生 (재성 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신강"), "正官格");
    expect(result!.pattern).toBe("財官相生");
    expect(result!.primary).toBe("fire");
  });

  it("신약 + 正官格 → 官印相生 (인성 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신약"), "正官格");
    expect(result!.pattern).toBe("官印相生");
    expect(result!.primary).toBe("metal");
  });
});

describe("buildGyeokgukYongshin — 재성격", () => {
  it("신강 + 財格 → 食傷生財 (식상 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신강"), "財格");
    expect(result!.pattern).toBe("食傷生財");
    expect(result!.primary).toBe("wood");
  });

  it("신약 + 財格 → 比劫制財 (비겁 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신약"), "財格");
    expect(result!.pattern).toBe("比劫制財");
    expect(result!.primary).toBe("water");
  });
});

describe("buildGyeokgukYongshin — 편인격", () => {
  it("신강 + 偏印格 → 食神制偏印 (식상 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신강"), "偏印格");
    expect(result!.pattern).toBe("食神制偏印");
    expect(result!.primary).toBe("wood");
  });

  it("신약 + 偏印格 → 印比相生 (비겁 용신)", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신약"), "偏印格");
    expect(result!.pattern).toBe("印比相生");
    expect(result!.primary).toBe("water");
  });
});

describe("buildGyeokgukYongshin — 종격 시 null + 기타 격국 null", () => {
  it("종격이면 null 반환", () => {
    const chart = chartWith("壬");
    const shen = shenOf("종아");
    expect(buildGyeokgukYongshin(chart, shen, "傷官格")).toBeNull();
  });

  it("기타 격국 (식신격 등) → null 반환", () => {
    const chart = chartWith("壬");
    const result = buildGyeokgukYongshin(chart, shenOf("신약"), "食神格");
    expect(result).toBeNull();
  });
});
