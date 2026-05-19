import type { SajuChart } from "../../types";
import type { Branch, Element } from "../../hanja";
import { STEM_ELEMENT } from "../../hanja";
import type { KoYongshin } from "../../types/yongshin";
import { computeShenStrength } from "../../lib/shen-strength";
import { buildJonggyeokYongshin } from "../../lib/jonggyeok";
import { buildGyeokgukYongshin } from "../../lib/gyeokguk-yongshin";

const PRODUCES: Record<Element, Element> = {
  wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
};
const PRODUCED_BY: Record<Element, Element> = {
  fire: "wood", earth: "fire", metal: "earth", water: "metal", wood: "water",
};
const CONTROLS: Record<Element, Element> = {
  wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire",
};

const BRANCH_SEASON: Record<Branch, "봄" | "여름" | "가을" | "겨울"> = {
  寅: "봄", 卯: "봄", 辰: "봄",
  巳: "여름", 午: "여름", 未: "여름",
  申: "가을", 酉: "가을", 戌: "가을",
  亥: "겨울", 子: "겨울", 丑: "겨울",
};

function computeJohuMode(monthBranch: Branch): "한랭" | "조열" | "균형" {
  const season = BRANCH_SEASON[monthBranch];
  if (season === "겨울") return "한랭";
  if (season === "여름") return "조열";
  return "균형";
}

/**
 * 한국식 자평 + 조후 혼합 — v0.3.
 *
 * 우선순위:
 *  1. 종격 (jonggyeokKind != null)
 *  2. 격국 분기 (4 격국 × 2 신강도)
 *  3. fallback — 기본 자평
 *
 * 조후 보조용신은 항상 결합 — 한랭 → 火 / 조열 → 水.
 */
export function buildYongshinKo(chart: SajuChart): KoYongshin {
  const shen = computeShenStrength(chart);
  const johu = computeJohuMode(chart.pillars.month.branch);
  const dayElement = STEM_ELEMENT[chart.pillars.day.stem];

  let secondary: Element | undefined;
  if (johu === "한랭") secondary = "fire";
  else if (johu === "조열") secondary = "water";

  // 1순위: 종격
  const jong = buildJonggyeokYongshin(shen);
  if (jong) {
    return {
      school: "ko",
      primary: jong.primary,
      secondary,
      gisin: jong.gisin,
      basisShenStrength: shen.verdict,
      basisJohuMode: johu,
      rationale: jong.rationale,
    };
  }

  // 2순위: 격국 분기
  const gyeok = buildGyeokgukYongshin(chart, shen, chart.pattern);
  if (gyeok) {
    return {
      school: "ko",
      primary: gyeok.primary,
      secondary,
      gisin: gyeok.gisin,
      basisShenStrength: shen.verdict,
      basisJohuMode: johu,
      rationale: gyeok.rationale,
    };
  }

  // 3순위: fallback (기존 v0.2 로직)
  let primary: Element;
  let gisin: Element[];
  if (shen.verdict === "신강") {
    primary = PRODUCES[dayElement];
    gisin = [PRODUCED_BY[dayElement], dayElement];
  } else if (shen.verdict === "신약") {
    primary = PRODUCED_BY[dayElement];
    gisin = [PRODUCES[dayElement], CONTROLS[dayElement]];
  } else {
    primary = PRODUCES[dayElement];
    gisin = [];
  }

  // 조후 충돌 시 조후 우선
  if (secondary && gisin.includes(secondary)) {
    [primary, secondary] = [secondary, primary];
    gisin = gisin.filter((g) => g !== primary);
  }

  return {
    school: "ko",
    primary, secondary, gisin,
    basisShenStrength: shen.verdict,
    basisJohuMode: johu,
  };
}
