import type { SajuChart } from "../types";
import type { Element } from "../hanja";
import { STEM_ELEMENT } from "../hanja";
import type { ShenStrengthResult } from "./shen-strength";

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

export type GyeokgukPattern =
  | "傷官生財" | "傷官佩印"
  | "官印相生" | "財官相生"
  | "比劫制財" | "食傷生財"
  | "食神制偏印" | "印比相生"
  | "기타";

export interface GyeokgukYongshin {
  primary: Element;
  gisin: Element[];
  pattern: GyeokgukPattern;
  rationale: string;
}

const SUPPORTED_GYEOKGUK = new Set(["傷官格", "正官格", "財格", "偏印格"]);

export function buildGyeokgukYongshin(
  chart: SajuChart,
  shen: ShenStrengthResult,
  gyeokguk: string,
): GyeokgukYongshin | null {
  if (shen.jonggyeokKind) return null;
  if (!SUPPORTED_GYEOKGUK.has(gyeokguk)) return null;
  if (shen.verdict !== "신강" && shen.verdict !== "신약") return null;

  const dayEl = STEM_ELEMENT[chart.pillars.day.stem];
  const sangwan = PRODUCES[dayEl];
  const insung = PRODUCED_BY[dayEl];
  const jaeseong = CONTROLS[dayEl];
  const gwanseong = CONTROLLED_BY[dayEl];
  const bigup = dayEl;

  if (gyeokguk === "傷官格") {
    if (shen.verdict === "신강") {
      return {
        primary: jaeseong, gisin: [insung, bigup],
        pattern: "傷官生財",
        rationale: "신강 상관격 — 재성으로 상관을 흘려 보냄",
      };
    }
    return {
      primary: insung, gisin: [sangwan, jaeseong],
      pattern: "傷官佩印",
      rationale: "신약 상관격 — 인성으로 상관을 제어",
    };
  }

  if (gyeokguk === "正官格") {
    if (shen.verdict === "신강") {
      return {
        primary: jaeseong, gisin: [bigup],
        pattern: "財官相生",
        rationale: "신강 정관격 — 재성이 관성을 생함",
      };
    }
    return {
      primary: insung, gisin: [jaeseong, sangwan],
      pattern: "官印相生",
      rationale: "신약 정관격 — 관성이 인성을 생함",
    };
  }

  if (gyeokguk === "財格") {
    if (shen.verdict === "신강") {
      return {
        primary: sangwan, gisin: [insung, bigup],
        pattern: "食傷生財",
        rationale: "신강 재성격 — 식상이 재성을 생함",
      };
    }
    return {
      primary: bigup, gisin: [jaeseong, gwanseong],
      pattern: "比劫制財",
      rationale: "신약 재성격 — 비겁으로 재성을 다스림",
    };
  }

  if (gyeokguk === "偏印格") {
    if (shen.verdict === "신강") {
      return {
        primary: sangwan, gisin: [insung, bigup],
        pattern: "食神制偏印",
        rationale: "신강 편인격 — 식신으로 편인을 제어",
      };
    }
    return {
      primary: bigup, gisin: [jaeseong, sangwan],
      pattern: "印比相生",
      rationale: "신약 편인격 — 인성과 비겁이 상생",
    };
  }

  return null;
}
