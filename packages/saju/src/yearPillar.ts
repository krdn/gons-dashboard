import { Solar } from "lunar-javascript";
import type { Pillar } from "./types";
import type { Stem, Branch } from "./hanja";

/** 양력 년도 → 그 해의 간지. 입춘 후 6월 1일 정오 기준. */
export function computeYearPillar(year: number): Pillar {
  return computeYearPillarFromDate(`${year}-06-01`);
}

/** 특정 양력 날짜 기준의 연주. 입춘 경계 정확히 반영. */
export function computeYearPillarFromDate(date: string): Pillar {
  const [y, m, d] = date.split("-").map(Number);
  const solar = Solar.fromYmdHms(y, m, d, 12, 0, 0);
  const ec = solar.getLunar().getEightChar();
  return {
    stem: ec.getYearGan() as Stem,
    branch: ec.getYearZhi() as Branch,
  };
}
