import type { Element } from "../hanja";
import type { ShenStrengthResult, Role } from "./shen-strength";

const PRODUCES: Record<Element, Element> = {
  wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
};
const PRODUCED_BY: Record<Element, Element> = {
  fire: "wood", earth: "fire", metal: "earth", water: "metal", wood: "water",
};
const CONTROLS: Record<Element, Element> = {
  wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire",
};
const CONTROLLED_BY: Record<Element, Element> = {
  wood: "metal", fire: "water", earth: "wood", metal: "fire", water: "earth",
};

function roleToElement(dayEl: Element, role: Role): Element {
  switch (role) {
    case "비겁": return dayEl;
    case "인성": return PRODUCED_BY[dayEl];
    case "식상": return PRODUCES[dayEl];
    case "재성": return CONTROLS[dayEl];
    case "관성": return CONTROLLED_BY[dayEl];
  }
}

export interface JonggyeokYongshin {
  primary: Element;
  gisin: Element[];
  rationale: string;
}

export function buildJonggyeokYongshin(
  shen: ShenStrengthResult,
): JonggyeokYongshin | null {
  if (!shen.jonggyeokKind || !shen.jonggyeokRole) return null;

  const primary = roleToElement(shen.dayElement, shen.jonggyeokRole);
  const insungEl = PRODUCED_BY[shen.dayElement];
  const gisin = [shen.dayElement, insungEl];

  const verdictKor =
    shen.verdict === "종아" ? "종아격" :
    shen.verdict === "종재" ? "종재격" : "종살격";

  const r = shen.roleCountExtended;
  const rationale = `인성 ${r.인성}·비겁 ${r.비겁} 약함, ${shen.jonggyeokRole} ${r[shen.jonggyeokRole]} 우세 — ${shen.jonggyeokKind} ${verdictKor}으로 ${shen.jonggyeokRole}의 흐름을 따른다`;

  return { primary, gisin, rationale };
}
