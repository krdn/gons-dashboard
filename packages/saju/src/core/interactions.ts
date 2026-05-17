import type { SajuPillars, Branch } from "../types";

/**
 * 합충형(合冲刑) — 사주 지지 상호작용.
 * 순수 함수: 4기둥 입력 → {hap, chong, hyung}.
 *
 * - 육합(六合): 두 지지가 결합 (子丑, 寅亥, 卯戌, 辰酉, 巳申, 午未)
 * - 충(冲):    두 지지가 정면 충돌 (子午, 丑未, 寅申, 卯酉, 辰戌, 巳亥)
 * - 형(刑):    삼형(寅巳申, 丑戌未), 상형(子卯), 자형(辰辰·午午·酉酉·亥亥)
 */
export type HyungType = "삼형" | "상형" | "자형";

export interface Interactions {
  hap: Array<{ branches: Branch[]; type: "육합" }>;
  chong: Array<{ branches: Branch[]; type: "충" }>;
  hyung: Array<{ branches: Branch[]; type: HyungType }>;
}

const SIX_HAP: ReadonlyArray<[Branch, Branch]> = [
  ["子", "丑"],
  ["寅", "亥"],
  ["卯", "戌"],
  ["辰", "酉"],
  ["巳", "申"],
  ["午", "未"],
];

const CHONG_PAIRS: ReadonlyArray<[Branch, Branch]> = [
  ["子", "午"],
  ["丑", "未"],
  ["寅", "申"],
  ["卯", "酉"],
  ["辰", "戌"],
  ["巳", "亥"],
];

const HYUNG_GROUPS: ReadonlyArray<{ type: HyungType; branches: ReadonlyArray<Branch> }> = [
  { type: "삼형", branches: ["寅", "巳", "申"] },
  { type: "삼형", branches: ["丑", "戌", "未"] },
  { type: "상형", branches: ["子", "卯"] },
  { type: "자형", branches: ["辰", "辰"] },
  { type: "자형", branches: ["午", "午"] },
  { type: "자형", branches: ["酉", "酉"] },
  { type: "자형", branches: ["亥", "亥"] },
];

export function computeInteractions(pillars: SajuPillars): Interactions {
  const branches: Branch[] = [
    pillars.year.branch,
    pillars.month.branch,
    pillars.day.branch,
    pillars.hour?.branch,
  ].filter((b): b is Branch => b != null);

  const hap = SIX_HAP
    .filter(([a, b]) => branches.includes(a) && branches.includes(b))
    .map(([a, b]) => ({ branches: [a, b] as Branch[], type: "육합" as const }));

  const chong = CHONG_PAIRS
    .filter(([a, b]) => branches.includes(a) && branches.includes(b))
    .map(([a, b]) => ({ branches: [a, b] as Branch[], type: "충" as const }));

  const hyung: Interactions["hyung"] = [];
  for (const group of HYUNG_GROUPS) {
    if (group.type === "자형") {
      const target = group.branches[0];
      const count = branches.filter(b => b === target).length;
      if (count >= 2) {
        hyung.push({ type: "자형", branches: [target, target] });
      }
    } else {
      const allPresent = group.branches.every(b => branches.includes(b));
      if (allPresent) {
        hyung.push({ type: group.type, branches: [...group.branches] });
      }
    }
  }

  return { hap, chong, hyung };
}
