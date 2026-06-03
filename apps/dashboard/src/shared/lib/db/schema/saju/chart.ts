// 사주 원국·해설 — Phase 1 spec §4 + Phase 3 lazy 캐시.
// - saju_charts: 원국 (결정적). profile_id UNIQUE, input_hash 불일치 시 무효화.
// - saju_readings: 섹션별 LLM 해설. model 컬럼으로 모델 변경 시 일괄 무효화.
// - llm_spend_log: feature='saju' 일별 KRW 합산. 미래 LLM 기능 공용.
// - saju_yearly_readings: 세운+월운 lazy 캐시 ((chart_id, year) UNIQUE)
// - saju_daily_fortunes: 매일 자정 cron 일괄 + 영구 보관 ((chart_id, for_date) UNIQUE)
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
  uniqueIndex,
  jsonb,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { fortuneProfiles } from "./profile";

export const sajuCharts = pgTable(
  "saju_charts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    yearStem: text("year_stem").notNull(),
    yearBranch: text("year_branch").notNull(),
    monthStem: text("month_stem").notNull(),
    monthBranch: text("month_branch").notNull(),
    dayStem: text("day_stem").notNull(),
    dayBranch: text("day_branch").notNull(),
    hourStem: text("hour_stem"),
    hourBranch: text("hour_branch"),
    elements: jsonb("elements").notNull().$type<{
      wood: number; fire: number; earth: number; metal: number; water: number;
    }>(),
    strength: text("strength").notNull(),
    tenGods: jsonb("ten_gods").notNull(),
    pattern: text("pattern").notNull(),
    yongSin: jsonb("yong_sin").notNull().$type<string[]>(),
    giSin: jsonb("gi_sin").notNull().$type<string[]>(),
    majorFortunes: jsonb("major_fortunes").notNull(),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saju_charts_profile_idx").on(t.profileId, t.inputHash, t.algorithmVersion)],
);

export const sajuReadings = pgTable(
  "saju_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => sajuCharts.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    body: text("body").notNull(),
    model: text("model").notNull(),
    // 캐시-리딩 모듈이 (model, promptVersion) 으로 cache 무효화. 모든 INSERT 는 명시 값 필수.
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saju_readings_chart_section_idx").on(t.chartId, t.section),
  ],
);

export const llmSpendLog = pgTable(
  "llm_spend_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    krw: numeric("krw", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("llm_spend_log_feature_day_idx").on(t.feature, t.createdAt)],
);

export const sajuYearlyReadings = pgTable(
  "saju_yearly_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => sajuCharts.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    yearStem: text("year_stem").notNull(),
    yearBranch: text("year_branch").notNull(),
    body: text("body").notNull(),
    model: text("model").notNull(),
    // 캐시-리딩 모듈이 (model, promptVersion) 으로 cache 무효화. 모든 INSERT 는 명시 값 필수.
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saju_yearly_readings_chart_year_idx").on(t.chartId, t.year),
  ],
);

export const sajuDailyFortunes = pgTable(
  "saju_daily_fortunes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => sajuCharts.id, { onDelete: "cascade" }),
    forDate: date("for_date").notNull(),
    dayStem: text("day_stem").notNull(),
    dayBranch: text("day_branch").notNull(),
    payload: jsonb("payload").notNull(),
    model: text("model").notNull(),
    // 캐시-리딩 모듈이 (model, promptVersion) 으로 cache 무효화. 모든 INSERT 는 명시 값 필수.
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saju_daily_fortunes_chart_date_idx").on(t.chartId, t.forDate),
    index("saju_daily_fortunes_date_idx").on(t.forDate),
  ],
);
