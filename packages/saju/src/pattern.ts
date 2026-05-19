import type { Element } from "./hanja";
import { BRANCH_MAIN_STEM, STEM_ELEMENT } from "./hanja";
import { tenGodOfStem } from "./tenGods";
import type { SajuPillars, Strength } from "./types";

export interface ComputePatternInput {
  pillars: SajuPillars;
  strength: Strength;
}

export interface PatternResult {
  pattern: string; // 한자 e.g. "偏印格"
  yongSin: Element[];
  giSin: Element[];
}

// 일간이 극하는 오행 (財) — 오행 상극의 다음 자리
const ELEMENT_CTRL_NEXT: Record<Element, Element> = {
  wood: "earth",
  earth: "water",
  water: "fire",
  fire: "metal",
  metal: "wood",
};

// 일간을 극하는 오행 (官) — 오행 상극의 이전 자리
const ELEMENT_CTRL_PREV: Record<Element, Element> = {
  water: "earth",
  fire: "water",
  metal: "fire",
  wood: "metal",
  earth: "wood",
};

// 일간을 생하는 오행 (印) — 오행 상생의 이전 자리
const ELEMENT_GEN_PREV: Record<Element, Element> = {
  wood: "water",
  fire: "wood",
  earth: "fire",
  metal: "earth",
  water: "metal",
};

const TEN_GOD_TO_PATTERN: Record<string, string> = {
  比肩: "比肩格",
  劫財: "劫財格",
  食神: "食神格",
  傷官: "傷官格",
  偏財: "偏財格",
  正財: "正財格",
  偏官: "偏官格",
  正官: "正官格",
  偏印: "偏印格",
  正印: "正印格",
};

export function computePattern(input: ComputePatternInput): PatternResult {
  const { pillars, strength } = input;
  const dayStem = pillars.day.stem;
  const monthBranchMainStem = BRANCH_MAIN_STEM[pillars.month.branch];
  const monthTenGod = tenGodOfStem(dayStem, monthBranchMainStem);
  const pattern = TEN_GOD_TO_PATTERN[monthTenGod] ?? "未定格";

  const dayEl = STEM_ELEMENT[dayStem];
  const strongLike = strength === "신강";

  const yongSin: Element[] = strongLike
    ? [
        ELEMENT_CTRL_NEXT[dayEl], // 일간이 극하는 (財)
        ELEMENT_CTRL_PREV[dayEl], // 일간을 극하는 (官)
      ]
    : [
        ELEMENT_GEN_PREV[dayEl], // 일간을 생하는 (印)
        dayEl, // 비겁 (자체 보강)
      ];
  const giSin: Element[] = yongSin.map((e) => ELEMENT_CTRL_NEXT[e]);

  return { pattern, yongSin, giSin };
}
