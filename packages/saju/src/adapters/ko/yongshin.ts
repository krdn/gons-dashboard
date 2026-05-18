import type { SajuChart } from "../../types";
import type { Branch, Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "../../hanja";
import type { KoYongshin, ShenStrengthBasis } from "../../types/yongshin";

// 12지지 → 계절 (조후 판정용)
const BRANCH_SEASON: Record<Branch, "봄" | "여름" | "가을" | "겨울"> = {
  寅: "봄", 卯: "봄", 辰: "봄",
  巳: "여름", 午: "여름", 未: "여름",
  申: "가을", 酉: "가을", 戌: "가을",
  亥: "겨울", 子: "겨울", 丑: "겨울",
};

// 5행 상생/상극
const PRODUCES: Record<Element, Element> = {
  wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
};
const PRODUCED_BY: Record<Element, Element> = {
  fire: "wood", earth: "fire", metal: "earth", water: "metal", wood: "water",
};
const CONTROLS: Record<Element, Element> = {
  wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire",
};

/** 일간 대비 한 오행의 역할 분류 */
function classify(
  dayElement: Element,
  target: Element,
): "비겁" | "인성" | "식상" | "재성" | "관성" {
  if (target === dayElement) return "비겁";
  if (target === PRODUCED_BY[dayElement]) return "인성";    // 나를 생하는 오행
  if (target === PRODUCES[dayElement]) return "식상";       // 내가 생하는 오행
  if (target === CONTROLS[dayElement]) return "재성";       // 내가 극하는 오행
  return "관성";                                            // 나를 극하는 오행
}

function computeShenStrength(chart: SajuChart): ShenStrengthBasis {
  const { year, month, day, hour } = chart.pillars;
  const dayElement = STEM_ELEMENT[day.stem];
  const all: Element[] = [
    STEM_ELEMENT[year.stem],
    STEM_ELEMENT[month.stem],
    STEM_ELEMENT[day.stem],
    BRANCH_ELEMENT[year.branch],
    BRANCH_ELEMENT[month.branch],
    BRANCH_ELEMENT[day.branch],
  ];
  if (hour) {
    all.push(STEM_ELEMENT[hour.stem], BRANCH_ELEMENT[hour.branch]);
  }

  let support = 0;  // 인성+비겁
  let drain = 0;    // 식상+재성+관성
  for (const e of all) {
    const role = classify(dayElement, e);
    if (role === "비겁" || role === "인성") support++;
    else drain++;
  }

  const verdict: "신강" | "신약" | "균형" =
    support - drain >= 2 ? "신강" : drain - support >= 2 ? "신약" : "균형";

  return {
    dayStem: day.stem,
    monthBranch: month.branch,
    supportScore: support,
    drainScore: drain,
    verdict,
  };
}

function computeJohuMode(monthBranch: Branch): "한랭" | "조열" | "균형" {
  const season = BRANCH_SEASON[monthBranch];
  if (season === "겨울") return "한랭";
  if (season === "여름") return "조열";
  return "균형";
}

/**
 * 한국식 자평 + 조후 혼합 용신 — v0.2 단일 룰.
 *
 * 룰:
 *  - 신강 → 설기/극제 오행이 용신 (식상)
 *  - 신약 → 생부 오행이 용신 (인성)
 *  - 조후 한랭 → 火 보조 / 조열 → 水 보조 / 균형 → 보조 없음
 *  - 충돌(억부 용신 ∈ 조후 기신) 시 조후 우선 (primary 와 secondary 교환)
 */
export function buildYongshinKo(chart: SajuChart): KoYongshin {
  const basis = computeShenStrength(chart);
  const johu = computeJohuMode(chart.pillars.month.branch);
  const dayElement = STEM_ELEMENT[chart.pillars.day.stem];

  // 억부 후보
  let primary: Element;
  let gisin: Element[];
  if (basis.verdict === "신강") {
    primary = PRODUCES[dayElement];                     // 식상 (내가 생) — 설기
    gisin = [PRODUCED_BY[dayElement], dayElement];      // 인성·비겁
  } else if (basis.verdict === "신약") {
    primary = PRODUCED_BY[dayElement];                  // 인성
    gisin = [PRODUCES[dayElement], CONTROLS[dayElement]]; // 식상·재성
  } else {
    primary = PRODUCES[dayElement];                     // 균형 시 식상
    gisin = [];
  }

  // 조후 보조
  let secondary: Element | undefined;
  if (johu === "한랭") secondary = "fire";
  else if (johu === "조열") secondary = "water";

  // 충돌 시 조후 우선
  if (secondary && gisin.includes(secondary)) {
    [primary, secondary] = [secondary, primary];
    gisin = gisin.filter((g) => g !== primary);
  }

  return {
    school: "ko",
    primary,
    secondary,
    gisin,
    basisShenStrength: basis.verdict,
    basisJohuMode: johu,
  };
}
