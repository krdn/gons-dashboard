import type { SajuChart } from "../../types";
import type { Element } from "../../hanja";
import { STEM_ELEMENT } from "../../hanja";
import type { CnZipingYongshin } from "../../types/yongshin";
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

/**
 * 중국 자평 — 억부 단일 룰 (조후 미반영) — v0.3.
 *
 * 우선순위: 종격 → 격국 → fallback.
 */
export function buildYongshinCnZiping(chart: SajuChart): CnZipingYongshin {
  const shen = computeShenStrength(chart);
  const dayElement = STEM_ELEMENT[chart.pillars.day.stem];

  // 1순위: 종격
  const jong = buildJonggyeokYongshin(shen);
  if (jong) {
    return {
      school: "cn-ziping",
      primary: jong.primary,
      gisin: jong.gisin,
      basisShenStrength: shen.verdict,
      structureHint: "기타",
      rationale: jong.rationale,
    };
  }

  // 2순위: 격국 분기
  const gyeok = buildGyeokgukYongshin(chart, shen, chart.pattern);
  if (gyeok) {
    let structureHint: "식신생재" | "관인상생" | "기타" = "기타";
    if (gyeok.pattern === "食傷生財") structureHint = "식신생재";
    else if (gyeok.pattern === "官印相生") structureHint = "관인상생";
    return {
      school: "cn-ziping",
      primary: gyeok.primary,
      gisin: gyeok.gisin,
      basisShenStrength: shen.verdict,
      structureHint,
      rationale: gyeok.rationale,
    };
  }

  // 3순위: fallback
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

  let structureHint: "식신생재" | "관인상생" | "기타" = "기타";
  if (shen.verdict === "신강" && shen.roleCount["식상"] >= 1 && shen.roleCount["재성"] >= 1) {
    structureHint = "식신생재";
  } else if (shen.verdict === "신약" && shen.roleCount["관성"] >= 1 && shen.roleCount["인성"] >= 1) {
    structureHint = "관인상생";
  }

  return {
    school: "cn-ziping",
    primary, gisin,
    basisShenStrength: shen.verdict,
    structureHint,
  };
}
