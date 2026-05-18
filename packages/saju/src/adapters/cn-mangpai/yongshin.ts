import type { SajuChart } from "../../types";
import type { Stem, Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "../../hanja";
import type { CnMangpaiYongshin } from "../../types/yongshin";

const CONTROLS: Record<Element, Element> = {
  wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire",
};

// 일간별 단건업 식상-우선 용신 (간략 — 전체 120 조합 표는 v0.3)
const STEM_TO_YONGSHIN: Record<Stem, Element> = {
  甲: "fire", 乙: "fire",     // 木日 → 식상 火
  丙: "earth", 丁: "earth",   // 火日 → 식상 土
  戊: "metal", 己: "metal",   // 土日 → 식상 金
  庚: "water", 辛: "water",   // 金日 → 식상 水
  壬: "wood", 癸: "wood",     // 水日 → 식상 木
};

/**
 * 중국 맹파 — 단건업(段建業) 체계.
 *
 * 본 학파는 용신을 "응기 시점 시그널" 로 해석한다. v0.2 는 일간별 대표 용신
 * 1개(식상) + 월지에서 응기 hint 도출. 전체 120 조합 표는 v0.3.
 */
export function buildYongshinCnMangpai(chart: SajuChart): CnMangpaiYongshin {
  const { month, day } = chart.pillars;
  const dayElement = STEM_ELEMENT[day.stem];
  const primary = STEM_TO_YONGSHIN[day.stem];
  // gisin: 일간이 극하는 오행 (재성) — 단건업 v0.2 단일 시드.
  // 향후 표가 늘면 학파별 룰 다양화.
  const gisin = [CONTROLS[dayElement]];

  const monthEl = BRANCH_ELEMENT[month.branch];
  const emergenceHint =
    monthEl === primary
      ? `용신 ${primary} 가 월령 ${month.branch} 에 同氣 — 응기 강력`
      : `용신 ${primary} 가 월령 ${month.branch}(${monthEl}) 와 다름 — 대운/세운 ${primary} 도래 시 응기`;

  return { school: "cn-mangpai", primary, gisin, emergenceHint };
}
