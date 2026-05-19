import type { SajuChart, MajorFortune } from "../../types";
import type { Stem, Branch } from "../../hanja";
import type { JpYongshin } from "../../types/yongshin";
import type { MonthlyFrame } from "../../types/monthly";
import { computeMonthPillars } from "../../monthPillars";

const BRANCH_CONFLICTS: Partial<Record<Branch, Branch>> = {
  子: "午", 午: "子", 丑: "未", 未: "丑", 寅: "申", 申: "寅",
  卯: "酉", 酉: "卯", 辰: "戌", 戌: "辰", 巳: "亥", 亥: "巳",
};
const BRANCH_COMBOS: Partial<Record<Branch, Branch>> = {
  子: "丑", 丑: "子", 寅: "亥", 亥: "寅", 卯: "戌", 戌: "卯",
  辰: "酉", 酉: "辰", 巳: "申", 申: "巳", 午: "未", 未: "午",
};

function monthGanjiOf(year: number, month: number): { stem: Stem; branch: Branch } {
  const pillars = computeMonthPillars(year);
  const p = pillars[month - 1].pillar;
  return { stem: p.stem, branch: p.branch };
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
 * 일본 추명학 월운 어댑터 — 12궁 통변성 favorable/unfavorable hint 노출.
 *
 * JP yongShin 은 오행 단위가 아닌 통변성 (재성/관성/인성 vs 식상/비겁) 단위라
 * yongShinDelta 는 항상 비어있고 netVerdict 는 "mixed" — yearly jp 와 동일.
 */
export function buildMonthlyJp(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  targetMonth: number;
  yongShin: JpYongshin;
  currentAge: number;
}): MonthlyFrame {
  const { chart, daeun, targetYear, targetMonth, yongShin, currentAge } = args;
  const monthGanji = monthGanjiOf(targetYear, targetMonth);

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

  const interactions: MonthlyFrame["ganjiInteractions"] = [];
  for (const p of pillars) {
    if (BRANCH_CONFLICTS[monthGanji.branch] === p.branch) {
      interactions.push({
        type: "충",
        subject: { pillar: p.pillar, element: p.branch },
        object: monthGanji.branch,
      });
    }
    if (BRANCH_COMBOS[monthGanji.branch] === p.branch) {
      interactions.push({
        type: "합",
        subject: { pillar: p.pillar, element: p.branch },
        object: monthGanji.branch,
      });
    }
  }

  return {
    school: "jp",
    targetYear,
    targetMonth,
    monthGanji,
    currentDaeun: {
      startAge: cur.startAge,
      endAge,
      ganji: { stem: cur.stem, branch: cur.branch },
    },
    daeunTransition,
    ganjiInteractions: interactions,
    yongShinDelta: { reinforced: [], weakened: [], netVerdict: "mixed" },
    schoolSpecificHints: {
      favorable: yongShin.favorable.join("·"),
      unfavorable: yongShin.unfavorable.join("·"),
    },
    shensha: [],
    yongShinUsed: yongShin,
  };
}
