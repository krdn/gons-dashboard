/// <reference path="./lunar-javascript.d.ts" />
export { computeSajuChart } from "./computeSajuChart";
export { hashProfile } from "./hashProfile";
export type {
  SajuChart,
  SajuPillars,
  Pillar,
  ElementCount,
  TenGodAssignment,
  MajorFortune,
  Strength,
  ComputeSajuInput,
} from "./types";
export {
  STEMS,
  BRANCHES,
  STEM_KO,
  BRANCH_KO,
  ELEMENT_KO,
  ELEMENT_HANJA,
  STEM_ELEMENT,
  BRANCH_ELEMENT,
  TEN_GOD_KO,
} from "./hanja";
export type { Stem, Branch, Element, TenGod } from "./hanja";

// Phase 3 — 세운/월운/일진 계산 + 일진 payload 스키마
export { computeYearPillar, computeYearPillarFromDate } from "./yearPillar";
export { computeMonthPillars } from "./monthPillars";
export type { MonthPillar } from "./monthPillars";
export { computeDayPillar } from "./dayPillar";
export { tenGodsForPillar } from "./tenGodsFor";
export {
  dailyFortunePayloadSchema,
  dailyFortuneScoreSchema,
  dailyFortuneHourSlotSchema,
  dailyFortuneRemedySchema,
} from "./dailyFortune";
export type {
  DailyFortunePayload,
  DailyFortuneScore,
  DailyFortuneHourSlot,
  DailyFortuneRemedy,
} from "./dailyFortune";

// Task 1.2 — 출생 도시 자동완성 데이터셋
export { findCity, searchCities } from "./time/cityLookup";
export type { CityInfo } from "./time/cityLookup";

// Phase 5 — Tri-nation lifetime compose
export { resolveTrueSolar } from "./time/trueSolar";
export { verifyConsensus } from "./consensus";
export { computeShensha } from "./core/shensha";
export type { ShenshaEntry } from "./core/shensha";
export { computeInteractions } from "./core/interactions";
export type { Interactions } from "./core/interactions";
export { buildTriNationLifetime } from "./compose/lifetime";
export type { BirthInputResolved } from "./compose/lifetime";
export type {
  School,
  SchoolWithCompose,
  LifetimeFrame,
  TriNationLifetime,
  Result,
  SajuError,
  PillarAnnotation,
  DaeunHighlight,
  ConsensusReport,
  Conflict,
  TrueSolarMeta,
  ExtendedChart,
} from "./core/extendedTypes";
