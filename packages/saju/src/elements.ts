import type { Stem, Element } from "./hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "./hanja";
import type { SajuPillars, ElementCount, Strength } from "./types";

export function computeElements(pillars: SajuPillars): ElementCount {
  const counts: ElementCount = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };

  const bump = (el: Element) => {
    counts[el] += 1;
  };

  // Count all 8 stems/branches, or 6 if hour is null
  bump(STEM_ELEMENT[pillars.year.stem]);
  bump(BRANCH_ELEMENT[pillars.year.branch]);
  bump(STEM_ELEMENT[pillars.month.stem]);
  bump(BRANCH_ELEMENT[pillars.month.branch]);
  bump(STEM_ELEMENT[pillars.day.stem]);
  bump(BRANCH_ELEMENT[pillars.day.branch]);

  if (pillars.hour) {
    bump(STEM_ELEMENT[pillars.hour.stem]);
    bump(BRANCH_ELEMENT[pillars.hour.branch]);
  }

  return counts;
}

export function computeStrength(elements: ElementCount, dayStem: Stem): Strength {
  const dayEl = STEM_ELEMENT[dayStem];
  const count = elements[dayEl];

  if (count >= 4) return "very-strong";
  if (count === 3) return "strong";
  if (count === 2) return "balanced";
  if (count === 1) return "weak";
  return "very-weak";
}
