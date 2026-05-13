import { Solar } from "lunar-javascript";
import type { Pillar } from "./types";
import type { Stem, Branch } from "./hanja";

export interface MonthPillar {
  monthIndex: number;       // 1..12 (양력 월)
  pillar: Pillar;
  startSolarDate: string;   // YYYY-MM-15 (display용 근사)
  endSolarDate: string;
}

/**
 * 양력 년도 → 12개월 간지. 각 월의 15일 기준 EightChar.getMonthGan/Zhi 호출.
 * 절기 시작일은 정확히 계산하지 않고 YYYY-MM-15 근사값을 display 용으로 제공.
 */
export function computeMonthPillars(year: number): MonthPillar[] {
  const result: MonthPillar[] = [];
  for (let m = 1; m <= 12; m++) {
    const solar = Solar.fromYmdHms(year, m, 15, 12, 0, 0);
    const ec = solar.getLunar().getEightChar();
    const endMonth =
      m === 12
        ? `${year + 1}-01-14`
        : `${year}-${String(m + 1).padStart(2, "0")}-14`;
    result.push({
      monthIndex: m,
      pillar: {
        stem: ec.getMonthGan() as Stem,
        branch: ec.getMonthZhi() as Branch,
      },
      startSolarDate: `${year}-${String(m).padStart(2, "0")}-15`,
      endSolarDate: endMonth,
    });
  }
  return result;
}
