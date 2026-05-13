import { Solar, Lunar } from "lunar-javascript";
import type { Stem, Branch } from "./hanja";
import type { SajuPillars } from "./types";

export interface ComputePillarsInput {
  birthDate: string;            // YYYY-MM-DD
  birthTime: string | null;     // HH:MM
  calendar: "solar" | "lunar";
}

export function computePillars(input: ComputePillarsInput): SajuPillars {
  const [y, m, d] = input.birthDate.split("-").map(Number);
  const [hh, mm] = (input.birthTime ?? "12:00").split(":").map(Number);

  // 음력 입력은 양력으로 변환 후 동일 경로로 계산
  const solar = input.calendar === "solar"
    ? Solar.fromYmdHms(y, m, d, hh, mm, 0)
    : Lunar.fromYmdHms(y, m, d, hh, mm, 0).getSolar();

  const eightChar = solar.getLunar().getEightChar();

  return {
    year:  { stem: eightChar.getYearGan() as Stem,  branch: eightChar.getYearZhi() as Branch },
    month: { stem: eightChar.getMonthGan() as Stem, branch: eightChar.getMonthZhi() as Branch },
    day:   { stem: eightChar.getDayGan() as Stem,   branch: eightChar.getDayZhi() as Branch },
    hour:  input.birthTime
      ? { stem: eightChar.getTimeGan() as Stem, branch: eightChar.getTimeZhi() as Branch }
      : null,
  };
}
