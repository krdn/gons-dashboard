import type { SajuChart, MajorFortune } from "../../types";
import type { Stem, Branch, Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "../../hanja";
import type { KoYongshin } from "../../types/yongshin";
import type { MonthlyFrame } from "../../types/monthly";
import { computeMonthPillars } from "../../monthPillars";

// 지지 6충
const BRANCH_CONFLICTS: Partial<Record<Branch, Branch>> = {
  子: "午", 午: "子",
  丑: "未", 未: "丑",
  寅: "申", 申: "寅",
  卯: "酉", 酉: "卯",
  辰: "戌", 戌: "辰",
  巳: "亥", 亥: "巳",
};
// 지지 6합
const BRANCH_COMBOS: Partial<Record<Branch, Branch>> = {
  子: "丑", 丑: "子",
  寅: "亥", 亥: "寅",
  卯: "戌", 戌: "卯",
  辰: "酉", 酉: "辰",
  巳: "申", 申: "巳",
  午: "未", 未: "午",
};

/**
 * (year, month) → 월간지. computeMonthPillars(year)[month-1] 사용.
 * targetMonth: 1..12 (양력 KST 기준, 절기 시작일은 15일 근사로 처리됨).
 */
function monthGanjiOf(year: number, month: number): { stem: Stem; branch: Branch } {
  const pillars = computeMonthPillars(year);
  const p = pillars[month - 1].pillar;
  return { stem: p.stem, branch: p.branch };
}

/**
 * 현재 대운 + endAge 도출 (yearly 와 동일 로직).
 * 월운 안에서도 currentDaeun 컨텍스트를 LLM 에 제공한다.
 */
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
 * 한국식 월운 어댑터 — 월간지 ↔ 원국 충/합 + 용신 강약 + 대운 전환 hint.
 *
 * yearly KO 와 거의 동일하되 yearGanji → monthGanji 치환 + targetMonth 추가.
 * daeunTransition 의미: monthly 에서도 "currentAge+1 에 transition" 으로 yearly 와 동일
 * 로직 — 1년 안에 대운 전환이 있는 달들 모두 동일 hint 받음 (의도된 동작).
 */
export function buildMonthlyKo(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  targetMonth: number;
  yongShin: KoYongshin;
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

  // 월간지 ↔ 원국 4기둥 ganji 상호작용 (hour: null 안전)
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

  // yongShinDelta — 월간지 천간/지지 오행이 primary/secondary/gisin 에 포함되는지
  const monthStemEl = STEM_ELEMENT[monthGanji.stem];
  const monthBranchEl = BRANCH_ELEMENT[monthGanji.branch];
  const reinforced: Element[] = [];
  const weakened: Element[] = [];

  // v0.3 종격 cascade — 종아/종재/종살격은 primary 다음 흐름 (PRODUCES[primary]) 도 喜神
  const PRODUCES: Record<Element, Element> = {
    wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
  };
  const isJonggyeok =
    yongShin.basisShenStrength === "종아" ||
    yongShin.basisShenStrength === "종재" ||
    yongShin.basisShenStrength === "종살";
  const xishen: Element | null = isJonggyeok ? PRODUCES[yongShin.primary] : null;

  for (const el of [monthStemEl, monthBranchEl]) {
    if (el === yongShin.primary || el === yongShin.secondary || el === xishen) {
      if (!reinforced.includes(el)) reinforced.push(el);
    }
    if (yongShin.gisin.includes(el)) {
      if (!weakened.includes(el)) weakened.push(el);
    }
  }
  const netVerdict: "favorable" | "unfavorable" | "mixed" =
    reinforced.length > 0 && weakened.length === 0
      ? "favorable"
      : weakened.length > 0 && reinforced.length === 0
        ? "unfavorable"
        : "mixed";

  return {
    school: "ko",
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
    yongShinDelta: { reinforced, weakened, netVerdict },
    schoolSpecificHints: {
      johu: `${yongShin.basisJohuMode} 조후 기준 ${yongShin.secondary ?? "보조 용신 없음"} 보강`,
    },
    shensha: [],
    yongShinUsed: yongShin,
  };
}
