import type { SajuChart, MajorFortune } from "../../types";
import type { Stem, Branch, Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT, STEMS, BRANCHES } from "../../hanja";
import type { KoYongshin } from "../../types/yongshin";
import type { YearlyFrame } from "../../types/yearly";

/** 양력 연도 → 세군 (천간지지). 기준: 1984 = 甲子 (index 0) */
function yearGanjiOf(year: number): { stem: Stem; branch: Branch } {
  const diff = ((year - 1984) % 60 + 60) % 60;
  return { stem: STEMS[diff % 10], branch: BRANCHES[diff % 12] };
}

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
 * 현재 대운 + endAge 도출. MajorFortune 에 endAge 가 없으므로 다음 대운의
 * startAge - 1 로 계산 (마지막 대운은 startAge + 9). Plan revise §2 적용.
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
  // age 가 첫 대운 startAge 미만 또는 마지막 대운 endAge 초과 — 첫 항목 fallback.
  const first = daeun[0];
  const fallbackEnd = daeun[1] ? daeun[1].startAge - 1 : first.startAge + 9;
  return { d: first, endAge: fallbackEnd, nextDaeun: daeun[1] };
}

/**
 * 한국식 년운 어댑터 — 세군 ↔ 원국 충/합 + 용신 강약 변화 + 대운 전환 hint.
 */
export function buildYearlyKo(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  yongShin: KoYongshin;
  currentAge: number;
}): YearlyFrame {
  const { chart, daeun, targetYear, yongShin, currentAge } = args;
  const yearGanji = yearGanjiOf(targetYear);

  const { d: cur, endAge, nextDaeun } = findCurrentDaeun(daeun, currentAge);
  const willTransitionThisYear =
    !!nextDaeun && nextDaeun.startAge === currentAge + 1;
  const daeunTransition = willTransitionThisYear && nextDaeun
    ? {
        willTransitionAt: nextDaeun.startAge,
        nextGanji: { stem: nextDaeun.stem, branch: nextDaeun.branch },
      }
    : null;

  // 세군 ↔ 원국 4기둥 ganji 상호작용 (hour: null 안전)
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

  // yongShinDelta — 세군 천간/지지 오행이 primary/secondary/gisin 에 포함되는지
  const yearStemEl = STEM_ELEMENT[yearGanji.stem];
  const yearBranchEl = BRANCH_ELEMENT[yearGanji.branch];
  const reinforced: Element[] = [];
  const weakened: Element[] = [];

  // v0.3 종격 cascade — 종아/종재/종살격은 primary 다음 흐름 (PRODUCES[primary]) 도 喜神
  // 食傷生財(종아), 財官相生(종재), 官印相生(종살) 원리
  const PRODUCES: Record<Element, Element> = {
    wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
  };
  const isJonggyeok =
    yongShin.basisShenStrength === "종아" ||
    yongShin.basisShenStrength === "종재" ||
    yongShin.basisShenStrength === "종살";
  const xishen: Element | null = isJonggyeok ? PRODUCES[yongShin.primary] : null;

  for (const el of [yearStemEl, yearBranchEl]) {
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
    yearGanji,
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
    shensha: [],  // v0.2 는 결합 신살 skip (v0.3 도입)
    yongShinUsed: yongShin,
  };
}
