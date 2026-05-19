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

/**
 * v0.3: 자평 룰 호환 시그너처.
 *
 * 이전 v0.2 의 단순 개수 룰 (영어 5-tier) 을 한국어 3-tier (신강/균형/신약) 로 교체.
 * 정확한 자평 + 종격 판정은 SajuChart 전체가 필요 — computeSajuChart 가
 * computeShenStrength 를 직접 호출. 이 함수는 호환 유지용 fallback.
 */
export function computeStrength(elements: ElementCount, dayStem: Stem): Strength {
  const dayEl = STEM_ELEMENT[dayStem];
  const count = elements[dayEl];
  const total = (Object.values(elements) as number[]).reduce((s, v) => s + v, 0);
  const ratio = total > 0 ? count / total : 0;

  if (ratio >= 0.4) return "신강";
  if (ratio >= 0.25) return "균형";
  return "신약";
}
