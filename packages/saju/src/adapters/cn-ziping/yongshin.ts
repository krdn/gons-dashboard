import type { SajuChart } from "../../types";
import type { Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "../../hanja";
import type { CnZipingYongshin } from "../../types/yongshin";

const PRODUCES: Record<Element, Element> = {
  wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
};
const PRODUCED_BY: Record<Element, Element> = {
  fire: "wood", earth: "fire", metal: "earth", water: "metal", wood: "water",
};
const CONTROLS: Record<Element, Element> = {
  wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire",
};

function classify(d: Element, t: Element): "비겁" | "인성" | "식상" | "재성" | "관성" {
  if (t === d) return "비겁";
  if (t === PRODUCED_BY[d]) return "인성";
  if (t === PRODUCES[d]) return "식상";
  if (t === CONTROLS[d]) return "재성";
  return "관성";
}

/**
 * 중국 자평 — 억부 단일 룰 (조후 미반영).
 *
 * 룰: 신강 → 설기/극제 오행 용신, 신약 → 생부 오행 용신.
 * structureHint: 식신생재(신강+식상+재성) / 관인상생(신약+관성+인성) 인식.
 */
export function buildYongshinCnZiping(chart: SajuChart): CnZipingYongshin {
  const { year, month, day, hour } = chart.pillars;
  const dayElement = STEM_ELEMENT[day.stem];

  const all: Element[] = [
    STEM_ELEMENT[year.stem], STEM_ELEMENT[month.stem], STEM_ELEMENT[day.stem],
    BRANCH_ELEMENT[year.branch], BRANCH_ELEMENT[month.branch], BRANCH_ELEMENT[day.branch],
  ];
  if (hour) {
    all.push(STEM_ELEMENT[hour.stem], BRANCH_ELEMENT[hour.branch]);
  }

  let support = 0;
  let drain = 0;
  const roleCount: Record<string, number> = { 비겁: 0, 인성: 0, 식상: 0, 재성: 0, 관성: 0 };
  for (const e of all) {
    const role = classify(dayElement, e);
    roleCount[role]++;
    if (role === "비겁" || role === "인성") support++;
    else drain++;
  }

  const verdict: "신강" | "신약" | "균형" =
    support - drain >= 2 ? "신강" : drain - support >= 2 ? "신약" : "균형";

  let primary: Element;
  let gisin: Element[];
  if (verdict === "신강") {
    primary = PRODUCES[dayElement];                     // 식상
    gisin = [PRODUCED_BY[dayElement], dayElement];
  } else if (verdict === "신약") {
    primary = PRODUCED_BY[dayElement];                  // 인성
    gisin = [PRODUCES[dayElement], CONTROLS[dayElement]];
  } else {
    primary = PRODUCES[dayElement];
    gisin = [];
  }

  let structureHint: "식신생재" | "관인상생" | "기타" = "기타";
  if (verdict === "신강" && roleCount["식상"] >= 1 && roleCount["재성"] >= 1) {
    structureHint = "식신생재";
  } else if (verdict === "신약" && roleCount["관성"] >= 1 && roleCount["인성"] >= 1) {
    structureHint = "관인상생";
  }

  return { school: "cn-ziping", primary, gisin, basisShenStrength: verdict, structureHint };
}
