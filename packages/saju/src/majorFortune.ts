import { Solar, Lunar } from "lunar-javascript";
import type { Stem, Branch } from "./hanja";
import type { MajorFortune } from "./types";

export interface ComputeMajorFortunesInput {
  birthDate: string;
  birthTime: string | null;
  calendar: "solar" | "lunar";
  gender: "male" | "female";
}

export function computeMajorFortunes(input: ComputeMajorFortunesInput): MajorFortune[] {
  const [y, m, d] = input.birthDate.split("-").map(Number);
  const [hh, mm] = (input.birthTime ?? "12:00").split(":").map(Number);
  const solar = input.calendar === "solar"
    ? Solar.fromYmdHms(y, m, d, hh, mm, 0)
    : Lunar.fromYmdHms(y, m, d, hh, mm, 0).getSolar();

  const eightChar = solar.getLunar().getEightChar();
  // lunar-javascript: Yun.gender 1=男, 0=女
  const yun = eightChar.getYun(input.gender === "male" ? 1 : 0);

  // getDaYun(N)의 인덱스 0은 "대운 전 출생~입대운 직전" 구간(getGanZhi() === "").
  // 실제 대운 10개를 원하면 11개 받고 인덱스 1부터.
  const daYunList = yun.getDaYun(11).slice(1);

  return daYunList.map((dy: any) => ({
    startAge: dy.getStartAge(),
    startYear: dy.getStartYear(),
    stem: dy.getGanZhi().charAt(0) as Stem,
    branch: dy.getGanZhi().charAt(1) as Branch,
  }));
}
