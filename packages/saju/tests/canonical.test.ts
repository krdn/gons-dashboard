import { describe, expect, it } from "vitest";
import { computeSajuChart } from "../src/computeSajuChart";
import { buildYongshinKo } from "../src/adapters/ko/yongshin";
import { buildYongshinCnZiping } from "../src/adapters/cn-ziping/yongshin";
import type { SajuChart } from "../src/types";
import canonical1967 from "./fixtures/canonical-1967.json" with { type: "json" };

// buildChartFromExpected — synthetic fixture 용 헬퍼.
// pillars 를 직접 주입해 chart 합성 (daycomputation 우회).
function buildChartFromExpected(pillars: any, gyeokguk?: string): SajuChart {
  return {
    pillars,
    elements: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
    strength: "신약",
    tenGods: {} as SajuChart["tenGods"],
    pattern: gyeokguk ?? "",
    yongSin: [],
    giSin: [],
    majorFortunes: [],
    inputHash: "synthetic",
  };
}

// ── fixture 목록 ──────────────────────────────────────────────
const FIXTURES = [
  { name: "1967-03-29 김석곤 (가종 종아)", data: canonical1967 as any },
];

describe.each(FIXTURES)("canonical fixture — $name", ({ data }) => {
  const chart: SajuChart = (data as any).synthetic
    ? buildChartFromExpected(data.expected.pillars, data.expected.ko?.gyeokguk)
    : computeSajuChart({
        birthDate: data.input.birthDateLocal,
        birthTime: data.input.birthTimeLocal,
        calendar: data.input.calendar as "solar" | "lunar",
        gender: data.input.gender as "male" | "female",
        birthCity: null,
      });

  // 실제 계산 차트만 pillars 검증 (synthetic 은 expected.pillars 를 그대로 주입)
  if (!data.synthetic) {
    it("4주 = 丁未 癸卯 壬辰 癸卯", () => {
      expect(chart.pillars.year).toEqual(data.expected.pillars.year);
      expect(chart.pillars.month).toEqual(data.expected.pillars.month);
      expect(chart.pillars.day).toEqual(data.expected.pillars.day);
      expect(chart.pillars.hour).toEqual(data.expected.pillars.hour);
    });
  }

  if (data.expected.ko?.yongshin) {
    it("ko yongshin", () => {
      const koYong = buildYongshinKo(chart);
      const exp = data.expected.ko.yongshin;
      if (exp.primary) expect(koYong.primary).toBe(exp.primary);
      if (exp.gisin) expect(koYong.gisin).toEqual(expect.arrayContaining(exp.gisin));
      if (exp.basisShenStrength) expect(koYong.basisShenStrength).toBe(exp.basisShenStrength);
    });
  }

  if (data.expected.cnZiping?.yongshin) {
    it("cnZiping yongshin", () => {
      const zipYong = buildYongshinCnZiping(chart);
      const exp = data.expected.cnZiping.yongshin;
      if (exp.primary) expect(zipYong.primary).toBe(exp.primary);
      if (exp.gisin) expect(zipYong.gisin).toEqual(expect.arrayContaining(exp.gisin));
      if (exp.basisShenStrength) expect(zipYong.basisShenStrength).toBe(exp.basisShenStrength);
      if (exp.structureHint) expect(zipYong.structureHint).toBe(exp.structureHint);
    });
  }
});
