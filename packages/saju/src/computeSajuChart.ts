import { computePillars } from "./pillars";
import { computeTenGods } from "./tenGods";
import { computeElements } from "./elements";
import { computeShenStrength } from "./lib/shen-strength";
import { computePattern } from "./pattern";
import { computeMajorFortunes } from "./majorFortune";
import { hashProfile } from "./hashProfile";
import type { SajuChart, ComputeSajuInput } from "./types";

export function computeSajuChart(input: ComputeSajuInput): SajuChart {
  const pillars = computePillars(input);
  const elements = computeElements(pillars);
  // v0.3: partialChart 로 computeShenStrength 호출 — pillars 만 필요
  const partialChart = {
    pillars,
    elements,
    strength: "신약",
    tenGods: {} as SajuChart["tenGods"],
    pattern: "",
    yongSin: [],
    giSin: [],
    majorFortunes: [],
    inputHash: "",
  } as SajuChart;
  const strength = computeShenStrength(partialChart).verdict;
  const tenGods = computeTenGods(pillars);
  const { pattern, yongSin, giSin } = computePattern({ pillars, strength });
  const majorFortunes = computeMajorFortunes(input);
  return {
    pillars,
    elements,
    strength,
    tenGods,
    pattern,
    yongSin,
    giSin,
    majorFortunes,
    inputHash: hashProfile(input),
  };
}
