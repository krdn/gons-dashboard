import { computePillars } from "./pillars";
import { computeTenGods } from "./tenGods";
import { computeElements, computeStrength } from "./elements";
import { computePattern } from "./pattern";
import { computeMajorFortunes } from "./majorFortune";
import { hashProfile } from "./hashProfile";
import type { SajuChart, ComputeSajuInput } from "./types";

export function computeSajuChart(input: ComputeSajuInput): SajuChart {
  const pillars = computePillars(input);
  const elements = computeElements(pillars);
  const strength = computeStrength(elements, pillars.day.stem);
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
