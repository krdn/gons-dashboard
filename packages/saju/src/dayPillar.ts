import { Solar } from "lunar-javascript";
import type { Pillar } from "./types";
import type { Stem, Branch } from "./hanja";

/** 양력 날짜 (YYYY-MM-DD) → 일진 간지. */
export function computeDayPillar(date: string): Pillar {
  const [y, m, d] = date.split("-").map(Number);
  const solar = Solar.fromYmdHms(y, m, d, 12, 0, 0);
  const ec = solar.getLunar().getEightChar();
  return {
    stem: ec.getDayGan() as Stem,
    branch: ec.getDayZhi() as Branch,
  };
}
