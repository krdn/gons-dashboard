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
export { buildTriNationLifetime, deriveDaeunDirection } from "./compose/lifetime";
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

// v0.2 — 년운(歲運) + 용신 타입 정의
export type {
  Yongshin,
  KoYongshin,
  CnZipingYongshin,
  CnMangpaiYongshin,
  JpYongshin,
  ShenStrengthBasis,
} from "./types/yongshin";
export type { YearlyFrame, TriNationYearly } from "./types/yearly";

// v0.2 — 4학파 용신/년운 어댑터 + TriNationYearly compose
export { buildYongshinKo } from "./adapters/ko/yongshin";
export { buildYearlyKo } from "./adapters/ko/yearly";
export { buildYongshinCnZiping } from "./adapters/cn-ziping/yongshin";
export { buildYearlyCnZiping } from "./adapters/cn-ziping/yearly";
export { buildYongshinCnMangpai } from "./adapters/cn-mangpai/yongshin";
export { buildYearlyCnMangpai } from "./adapters/cn-mangpai/yearly";
export { buildYongshinJp } from "./adapters/jp/yongshin";
export { buildYearlyJp } from "./adapters/jp/yearly";
export { buildTriNationYearly, buildTriNationYearlyFromBirth } from "./compose/yearly";
export { ALGORITHM_VERSION } from "./lib/algorithm-version";

// v0.3 — 월운(月運) 타입 + 4학파 어댑터 + TriNationMonthly compose
export type { MonthlyFrame, TriNationMonthly } from "./types/monthly";
export { buildMonthlyKo } from "./adapters/ko/monthly";
export { buildMonthlyCnZiping } from "./adapters/cn-ziping/monthly";
export { buildMonthlyCnMangpai } from "./adapters/cn-mangpai/monthly";
export { buildMonthlyJp } from "./adapters/jp/monthly";
export { buildTriNationMonthly, buildTriNationMonthlyFromBirth } from "./compose/monthly";

// v0.3 — tri 일진(日辰) 단순화 타입 + 4학파 어댑터 + TriNationDailyLite compose
export type { DailyLiteFrame, TriNationDailyLite } from "./types/daily-tri";
export { buildDailyLiteKo } from "./adapters/ko/daily";
export { buildDailyLiteCnZiping } from "./adapters/cn-ziping/daily";
export { buildDailyLiteCnMangpai } from "./adapters/cn-mangpai/daily";
export { buildDailyLiteJp } from "./adapters/jp/daily";
export {
  buildTriNationDailyLite,
  buildTriNationDailyLiteFromBirth,
} from "./compose/daily-tri";
