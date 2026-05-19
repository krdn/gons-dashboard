import type { SajuChart } from "../types";
import type { Element, Stem, Branch } from "../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "../hanja";
import { BRANCH_HIDDEN_STEMS } from "./branchHiddenStems";

export type Role = "비겁" | "인성" | "식상" | "재성" | "관성";

export type ShenVerdict =
  | "신강" | "신약" | "균형"
  | "종아" | "종재" | "종살";

export interface ShenStrengthResult {
  dayElement: Element;
  supportScore: number;
  drainScore: number;
  roleCount: Record<Role, number>;
  roleCountExtended: Record<Role, number>;
  verdict: ShenVerdict;
  jonggyeokKind: "완전종" | "가종" | null;
  jonggyeokRole: Role | null;
}

const PRODUCES: Record<Element, Element> = {
  wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
};
const PRODUCED_BY: Record<Element, Element> = {
  fire: "wood", earth: "fire", metal: "earth", water: "metal", wood: "water",
};
const CONTROLS: Record<Element, Element> = {
  wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire",
};

export function classifyRole(dayEl: Element, target: Element): Role {
  if (target === dayEl) return "비겁";
  if (target === PRODUCED_BY[dayEl]) return "인성";
  if (target === PRODUCES[dayEl]) return "식상";
  if (target === CONTROLS[dayEl]) return "재성";
  return "관성";
}

function emptyRoleCount(): Record<Role, number> {
  return { 비겁: 0, 인성: 0, 식상: 0, 재성: 0, 관성: 0 };
}

function detectJonggyeok(
  roleCount: Record<Role, number>,
): { kind: "완전종" | "가종"; role: Role } | null {
  const { 비겁, 인성, 식상, 재성, 관성 } = roleCount;
  const dayHelperScore = 비겁 + 인성;

  const candidates: { role: Role; count: number }[] = [
    { role: "식상", count: 식상 },
    { role: "재성", count: 재성 },
    { role: "관성", count: 관성 },
  ];
  const dominant = candidates.reduce((max, c) => c.count > max.count ? c : max);

  if (인성 === 0 && 비겁 <= 1 && dominant.count >= 6) {
    return { kind: "완전종", role: dominant.role };
  }

  if (
    인성 <= 1 &&
    dominant.count >= dayHelperScore * 1.3 &&
    dominant.count >= 4
  ) {
    return { kind: "가종", role: dominant.role };
  }

  return null;
}

export function computeShenStrength(chart: SajuChart): ShenStrengthResult {
  const { year, month, day, hour } = chart.pillars;
  const dayElement = STEM_ELEMENT[day.stem];

  const stems: Stem[] = [year.stem, month.stem, day.stem];
  const branches: Branch[] = [year.branch, month.branch, day.branch];
  if (hour) {
    stems.push(hour.stem);
    branches.push(hour.branch);
  }

  const roleCount = emptyRoleCount();
  for (const s of stems) {
    const el = STEM_ELEMENT[s];
    roleCount[classifyRole(dayElement, el)]++;
  }
  for (const b of branches) {
    const el = BRANCH_ELEMENT[b];
    roleCount[classifyRole(dayElement, el)]++;
  }

  const supportScore = roleCount["비겁"] + roleCount["인성"];
  const drainScore = roleCount["식상"] + roleCount["재성"] + roleCount["관성"];

  const roleCountExtended: Record<Role, number> = { ...roleCount };
  for (const b of branches) {
    const hidden = BRANCH_HIDDEN_STEMS[b];
    for (const hs of hidden) {
      const el = STEM_ELEMENT[hs];
      roleCountExtended[classifyRole(dayElement, el)]++;
    }
  }

  const jong = detectJonggyeok(roleCountExtended);
  if (jong) {
    const verdict: ShenVerdict =
      jong.role === "식상" ? "종아" :
      jong.role === "재성" ? "종재" : "종살";
    return {
      dayElement,
      supportScore, drainScore,
      roleCount, roleCountExtended,
      verdict,
      jonggyeokKind: jong.kind,
      jonggyeokRole: jong.role,
    };
  }

  const diff = supportScore - drainScore;
  const verdict: ShenVerdict =
    diff >= 2 ? "신강" : diff <= -2 ? "신약" : "균형";

  return {
    dayElement,
    supportScore, drainScore,
    roleCount, roleCountExtended,
    verdict,
    jonggyeokKind: null,
    jonggyeokRole: null,
  };
}
