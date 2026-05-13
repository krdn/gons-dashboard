import type { Stem, Branch, Element, TenGod } from "./hanja";

export type { Stem, Branch, Element, TenGod };

export interface Pillar {
  stem: Stem;
  branch: Branch;
}

export interface SajuPillars {
  year: Pillar;
  month: Pillar;
  day: Pillar;
  hour: Pillar | null; // 출생시 모르면 null
}

export interface ElementCount {
  wood: number; fire: number; earth: number; metal: number; water: number;
}

export interface TenGodAssignment {
  yearStem: TenGod;
  yearBranch: TenGod;
  monthStem: TenGod;
  monthBranch: TenGod;
  dayBranch: TenGod; // 일간은 자기 자신이라 십신 없음
  hourStem: TenGod | null;
  hourBranch: TenGod | null;
}

export interface MajorFortune {
  startAge: number;     // 입대운 나이 (만)
  startYear: number;    // 시작 연도 (양력)
  stem: Stem;
  branch: Branch;
}

export type Strength = "very-strong" | "strong" | "balanced" | "weak" | "very-weak";

export interface SajuChart {
  pillars: SajuPillars;
  elements: ElementCount;
  strength: Strength;
  tenGods: TenGodAssignment;
  pattern: string;      // 격국 한자 e.g. "偏印格"
  yongSin: Element[];   // 용신 오행
  giSin: Element[];     // 기신 오행
  majorFortunes: MajorFortune[]; // 10개
  inputHash: string;
}

export interface ComputeSajuInput {
  birthDate: string;            // YYYY-MM-DD
  birthTime: string | null;     // HH:MM or null
  calendar: "solar" | "lunar";
  gender: "male" | "female";
  birthCity: string | null;
}
