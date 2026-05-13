import type { Stem, Branch, TenGod, Element } from "./hanja";
import { STEM_ELEMENT, STEM_YIN_YANG, BRANCH_MAIN_STEM } from "./hanja";
import type { TenGodAssignment, SajuPillars } from "./types";

// 오행 상생: 木→火→土→金→水→木
const ELEMENT_GEN_NEXT: Record<Element, Element> = {
  wood: "fire",
  fire: "earth",
  earth: "metal",
  metal: "water",
  water: "wood",
};

// 오행 상극: 木→土, 土→水, 水→火, 火→金, 金→木
const ELEMENT_CTRL_NEXT: Record<Element, Element> = {
  wood: "earth",
  earth: "water",
  water: "fire",
  fire: "metal",
  metal: "wood",
};

/**
 * 일간(日干) 기준 다른 천간의 십신(十神)을 결정한다.
 *
 * 규칙:
 * - 같은 오행 + 같은 음양 → 比肩
 * - 같은 오행 + 다른 음양 → 劫財
 * - 일간이 생하는 오행 + 같은 음양 → 食神, 다른 음양 → 傷官
 * - 일간이 극하는 오행 + 같은 음양 → 偏財, 다른 음양 → 正財
 * - 일간을 극하는 오행 + 같은 음양 → 偏官(七殺), 다른 음양 → 正官
 * - 일간을 생하는 오행 + 같은 음양 → 偏印, 다른 음양 → 正印
 */
export function tenGodOfStem(dayStem: Stem, other: Stem): TenGod {
  const dayEl = STEM_ELEMENT[dayStem];
  const dayYy = STEM_YIN_YANG[dayStem];
  const otherEl = STEM_ELEMENT[other];
  const otherYy = STEM_YIN_YANG[other];
  const sameYy = dayYy === otherYy;

  if (otherEl === dayEl) return sameYy ? "比肩" : "劫財";
  if (otherEl === ELEMENT_GEN_NEXT[dayEl]) return sameYy ? "食神" : "傷官";
  if (otherEl === ELEMENT_CTRL_NEXT[dayEl]) return sameYy ? "偏財" : "正財";
  if (ELEMENT_CTRL_NEXT[otherEl] === dayEl) return sameYy ? "偏官" : "正官";
  if (ELEMENT_GEN_NEXT[otherEl] === dayEl) return sameYy ? "偏印" : "正印";
  throw new Error(`tenGodOfStem: unreachable for ${dayStem} vs ${other}`);
}

/**
 * 지지의 십신은 지지 본기(本氣) 천간을 대표로 사용한다.
 */
export function tenGodOfBranch(dayStem: Stem, branch: Branch): TenGod {
  return tenGodOfStem(dayStem, BRANCH_MAIN_STEM[branch]);
}

/**
 * 사주 네 기둥(연/월/일/시)의 천간·지지 십신을 한꺼번에 계산한다.
 * 일간은 자기 자신이므로 dayStem 필드는 결과에 포함되지 않는다.
 */
export function computeTenGods(pillars: SajuPillars): TenGodAssignment {
  const dayStem = pillars.day.stem;
  return {
    yearStem: tenGodOfStem(dayStem, pillars.year.stem),
    yearBranch: tenGodOfBranch(dayStem, pillars.year.branch),
    monthStem: tenGodOfStem(dayStem, pillars.month.stem),
    monthBranch: tenGodOfBranch(dayStem, pillars.month.branch),
    dayBranch: tenGodOfBranch(dayStem, pillars.day.branch),
    hourStem: pillars.hour ? tenGodOfStem(dayStem, pillars.hour.stem) : null,
    hourBranch: pillars.hour ? tenGodOfBranch(dayStem, pillars.hour.branch) : null,
  };
}
