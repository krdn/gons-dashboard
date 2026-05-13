import type { Pillar, Stem, TenGod } from "./types";
import { tenGodOfStem, tenGodOfBranch } from "./tenGods";

/**
 * 일간 + 외부 간지 → 십신 쌍.
 * 세운·월운·일진 해석에서 일간 vs 그 시점 간지의 관계를 도출.
 */
export function tenGodsForPillar(
  dayStem: Stem,
  pillar: Pillar,
): { stemTenGod: TenGod; branchTenGod: TenGod } {
  return {
    stemTenGod: tenGodOfStem(dayStem, pillar.stem),
    branchTenGod: tenGodOfBranch(dayStem, pillar.branch),
  };
}
