import type { SajuChart, MajorFortune } from "../../types";
import type { Stem, Branch, Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT, STEMS, BRANCHES } from "../../hanja";
import type { CnZipingYongshin } from "../../types/yongshin";
import type { YearlyFrame } from "../../types/yearly";

const BRANCH_CONFLICTS: Partial<Record<Branch, Branch>> = {
  子: "午", 午: "子", 丑: "未", 未: "丑", 寅: "申", 申: "寅",
  卯: "酉", 酉: "卯", 辰: "戌", 戌: "辰", 巳: "亥", 亥: "巳",
};
const BRANCH_COMBOS: Partial<Record<Branch, Branch>> = {
  子: "丑", 丑: "子", 寅: "亥", 亥: "寅", 卯: "戌", 戌: "卯",
  辰: "酉", 酉: "辰", 巳: "申", 申: "巳", 午: "未", 未: "午",
};

function yearGanjiOf(year: number): { stem: Stem; branch: Branch } {
  const diff = ((year - 1984) % 60 + 60) % 60;
  return { stem: STEMS[diff % 10], branch: BRANCHES[diff % 12] };
}

function findCurrentDaeun(
  daeun: MajorFortune[],
  age: number,
): { d: MajorFortune; endAge: number; nextDaeun?: MajorFortune } {
  for (let i = 0; i < daeun.length; i++) {
    const startAge = daeun[i].startAge;
    const endAge = daeun[i + 1] ? daeun[i + 1].startAge - 1 : startAge + 9;
    if (age >= startAge && age <= endAge) {
      return { d: daeun[i], endAge, nextDaeun: daeun[i + 1] };
    }
  }
  const first = daeun[0];
  const fallbackEnd = daeun[1] ? daeun[1].startAge - 1 : first.startAge + 9;
  return { d: first, endAge: fallbackEnd, nextDaeun: daeun[1] };
}

/**
 * 중국 자평 년운 어댑터 — KO 와 동일 구조, schoolSpecificHints 만 structureHint
 * 기반. yongShin 에 secondary 가 없으므로 reinforced 룰도 단순 (primary 만 검사).
 */
export function buildYearlyCnZiping(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  yongShin: CnZipingYongshin;
  currentAge: number;
}): YearlyFrame {
  const { chart, daeun, targetYear, yongShin, currentAge } = args;
  const yearGanji = yearGanjiOf(targetYear);

  const { d: cur, endAge, nextDaeun } = findCurrentDaeun(daeun, currentAge);
  const daeunTransition = nextDaeun && nextDaeun.startAge === currentAge + 1
    ? {
        willTransitionAt: nextDaeun.startAge,
        nextGanji: { stem: nextDaeun.stem, branch: nextDaeun.branch },
      }
    : null;

  const { year, month, day, hour } = chart.pillars;
  const pillars: { pillar: "year" | "month" | "day" | "hour"; branch: Branch }[] = [
    { pillar: "year", branch: year.branch },
    { pillar: "month", branch: month.branch },
    { pillar: "day", branch: day.branch },
  ];
  if (hour) pillars.push({ pillar: "hour", branch: hour.branch });

  const interactions: YearlyFrame["ganjiInteractions"] = [];
  for (const p of pillars) {
    if (BRANCH_CONFLICTS[yearGanji.branch] === p.branch) {
      interactions.push({
        type: "충",
        subject: { pillar: p.pillar, element: p.branch },
        object: yearGanji.branch,
      });
    }
    if (BRANCH_COMBOS[yearGanji.branch] === p.branch) {
      interactions.push({
        type: "합",
        subject: { pillar: p.pillar, element: p.branch },
        object: yearGanji.branch,
      });
    }
  }

  const yearStemEl = STEM_ELEMENT[yearGanji.stem];
  const yearBranchEl = BRANCH_ELEMENT[yearGanji.branch];
  const reinforced: Element[] = [];
  const weakened: Element[] = [];
  for (const el of [yearStemEl, yearBranchEl]) {
    if (el === yongShin.primary && !reinforced.includes(el)) reinforced.push(el);
    if (yongShin.gisin.includes(el) && !weakened.includes(el)) weakened.push(el);
  }
  const netVerdict: "favorable" | "unfavorable" | "mixed" =
    reinforced.length > 0 && weakened.length === 0
      ? "favorable"
      : weakened.length > 0 && reinforced.length === 0
        ? "unfavorable"
        : "mixed";

  return {
    school: "cn-ziping",
    targetYear,
    yearGanji,
    currentDaeun: {
      startAge: cur.startAge,
      endAge,
      ganji: { stem: cur.stem, branch: cur.branch },
    },
    daeunTransition,
    ganjiInteractions: interactions,
    yongShinDelta: { reinforced, weakened, netVerdict },
    schoolSpecificHints: { structure: yongShin.structureHint ?? "기타" },
    shensha: [],
    yongShinUsed: yongShin,
  };
}
