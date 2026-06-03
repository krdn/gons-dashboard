// 삼국 분석 (Korean / Chinese / Japanese) 캐시 — 호(虎) PlayMCP 상담 영역과 독립.
// v0.1 평생(lifetime) · v0.2 년운(yearly) · v0.3 월운(monthly) + tri 일진(daily).
// 각 단계: 결정형 frame (*_tri) + LLM narrative (*_narrative) 쌍.
// school CHECK / cache UNIQUE / 조회 INDEX 는 생성된 SQL 후처리(ALTER TABLE) 로 적용한다.
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
  uniqueIndex,
  jsonb,
  date,
} from "drizzle-orm/pg-core";
import type {
  TriNationLifetime,
  TriNationYearly,
  TriNationMonthly,
  TriNationDailyLite,
} from "@krdn/saju";
import { fortuneProfiles } from "./profile";
import type {
  LifetimeNarrativeSections,
  YearlyNarrativeSections,
  MonthlyNarrativeSections,
  SchoolSpecific,
} from "./narrative-types";

/* 삼국 분석 v0.1 평생 운세 캐시
 * - saju_lifetime_tri       : 결정형 LifetimeFrame ((profile_id, school, input_hash, schema_version) UNIQUE)
 * - saju_lifetime_narrative : LLM narrative ((profile_id, school, frame_hash, model_id) UNIQUE) */
export const sajuLifetimeTri = pgTable(
  "saju_lifetime_tri",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    inputHash: text("input_hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    frameJsonb: jsonb("frame_jsonb").$type<TriNationLifetime>().notNull(),
    computedAt: timestamp("computed_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_lifetime_tri_profile_idx").on(t.profileId),
    uniqueIndex("saju_lifetime_tri_cache_key").on(
      t.profileId,
      t.school,
      t.inputHash,
      t.schemaVersion,
      t.algorithmVersion,
    ),
  ],
);

export const sajuLifetimeNarrative = pgTable(
  "saju_lifetime_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    frameHash: text("frame_hash").notNull(),
    modelId: text("model_id").notNull(),
    // v0.2 — 프롬프트 스키마 버전. PROMPT_VERSION bump 시 자동으로 캐시 무효화.
    // 기존 row 는 default 1 로 채워지고, 신규 코드는 PROMPT_VERSION=2 로 적재.
    // integer (text 형 다른 promptVersion 컬럼과 달리) — 단조 증가 정수이므로 비교 연산 명확.
    promptVersion: integer("prompt_version").notNull().default(1),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    narrativeText: text("narrative_text").notNull(),
    sectionsJsonb: jsonb("sections_jsonb").$type<LifetimeNarrativeSections>().notNull(),
    // v0.2 — 학파별로 다른 구조. v1 row 는 null.
    schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),
    citations: text("citations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_lifetime_narrative_profile_idx").on(t.profileId),
    uniqueIndex("saju_lifetime_narrative_cache_key").on(
      t.profileId,
      t.school,
      t.frameHash,
      t.modelId,
      t.promptVersion,
      t.algorithmVersion,
    ),
  ],
);

/* 삼국 분석 v0.2 년운(歲運) 캐시
 * - saju_yearly_tri       : 결정형 TriNationYearly ((profile_id, school, target_year, input_hash, schema_version) UNIQUE)
 * - saju_yearly_narrative : LLM narrative ((profile_id, school, target_year, frame_hash, model_id) UNIQUE) */
export const sajuYearlyTri = pgTable(
  "saju_yearly_tri",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    targetYear: integer("target_year").notNull(),
    inputHash: text("input_hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    frameJsonb: jsonb("frame_jsonb").$type<TriNationYearly>().notNull(),
    computedAt: timestamp("computed_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_yearly_tri_profile_idx").on(t.profileId, t.targetYear),
    uniqueIndex("saju_yearly_tri_cache_key").on(
      t.profileId,
      t.school,
      t.targetYear,
      t.inputHash,
      t.schemaVersion,
      t.algorithmVersion,
    ),
  ],
);

export type SajuYearlyTriRow = typeof sajuYearlyTri.$inferSelect;

export const sajuYearlyNarrative = pgTable(
  "saju_yearly_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    targetYear: integer("target_year").notNull(),
    frameHash: text("frame_hash").notNull(),
    modelId: text("model_id").notNull(),
    // v0.3.1 — 프롬프트 스키마 버전. PROMPT_VERSION bump 시 자동으로 캐시 무효화.
    // 기존 row 는 default 1 로 채워지고, 신규 코드는 PROMPT_VERSION=2 로 적재.
    // lifetime narrative 와 동일 패턴.
    promptVersion: integer("prompt_version").notNull().default(1),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    narrativeText: text("narrative_text").notNull(),
    sectionsJsonb: jsonb("sections_jsonb").$type<YearlyNarrativeSections>().notNull(),
    // v0.3.1 — 학파별로 다른 구조. v1 row 는 null.
    schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),
    citations: text("citations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_yearly_narrative_profile_idx").on(t.profileId, t.targetYear),
    uniqueIndex("saju_yearly_narrative_cache_key").on(
      t.profileId,
      t.school,
      t.targetYear,
      t.frameHash,
      t.modelId,
      t.promptVersion,
      t.algorithmVersion,
    ),
  ],
);

export type SajuYearlyNarrativeRow = typeof sajuYearlyNarrative.$inferSelect;

/* 삼국 분석 v0.3 월운(月運) + tri 일진(日辰) 캐시
 * - saju_monthly_tri       : 결정형 TriNationMonthly ((profile_id, school, target_year, target_month, input_hash, schema_version, algorithm_version) UNIQUE)
 * - saju_monthly_narrative : 월운 LLM narrative ((profile_id, school, target_year, target_month, frame_hash, model_id, algorithm_version) UNIQUE)
 * - saju_daily_tri         : 결정형 TriNationDailyLite ((profile_id, for_date, input_hash, schema_version, algorithm_version) UNIQUE)
 * - saju_daily_narrative   : tri 일진 LLM narrative ((profile_id, school, for_date, frame_hash, model_id, algorithm_version) UNIQUE)
 *
 * v0.2 yearly 패턴(algorithm_version 포함) 재사용. */
export const sajuMonthlyTri = pgTable(
  "saju_monthly_tri",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    targetYear: integer("target_year").notNull(),
    targetMonth: integer("target_month").notNull(),
    inputHash: text("input_hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    frameJsonb: jsonb("frame_jsonb").$type<TriNationMonthly>().notNull(),
    computedAt: timestamp("computed_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_monthly_tri_profile_idx").on(
      t.profileId,
      t.targetYear,
      t.targetMonth,
    ),
    uniqueIndex("saju_monthly_tri_cache_key").on(
      t.profileId,
      t.school,
      t.targetYear,
      t.targetMonth,
      t.inputHash,
      t.schemaVersion,
      t.algorithmVersion,
    ),
  ],
);

export type SajuMonthlyTriRow = typeof sajuMonthlyTri.$inferSelect;

export const sajuMonthlyNarrative = pgTable(
  "saju_monthly_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    targetYear: integer("target_year").notNull(),
    targetMonth: integer("target_month").notNull(),
    frameHash: text("frame_hash").notNull(),
    modelId: text("model_id").notNull(),
    // v0.3.1 — yearly 와 동일 prompt_version 패턴.
    promptVersion: integer("prompt_version").notNull().default(1),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    narrativeText: text("narrative_text").notNull(),
    sectionsJsonb: jsonb("sections_jsonb").$type<MonthlyNarrativeSections>().notNull(),
    // v0.3.1 — 학파별로 다른 구조. v1 row 는 null.
    schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),
    citations: text("citations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_monthly_narrative_profile_idx").on(
      t.profileId,
      t.targetYear,
      t.targetMonth,
    ),
    uniqueIndex("saju_monthly_narrative_cache_key").on(
      t.profileId,
      t.school,
      t.targetYear,
      t.targetMonth,
      t.frameHash,
      t.modelId,
      t.promptVersion,
      t.algorithmVersion,
    ),
  ],
);

export type SajuMonthlyNarrativeRow = typeof sajuMonthlyNarrative.$inferSelect;

export const sajuDailyTri = pgTable(
  "saju_daily_tri",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    forDate: date("for_date").notNull(),
    inputHash: text("input_hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    frameJsonb: jsonb("frame_jsonb").$type<TriNationDailyLite>().notNull(),
    computedAt: timestamp("computed_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_daily_tri_date_idx").on(t.forDate),
    index("saju_daily_tri_profile_idx").on(t.profileId, t.forDate),
    uniqueIndex("saju_daily_tri_cache_key").on(
      t.profileId,
      t.forDate,
      t.inputHash,
      t.schemaVersion,
      t.algorithmVersion,
    ),
  ],
);

export type SajuDailyTriRow = typeof sajuDailyTri.$inferSelect;

export const sajuDailyNarrative = pgTable(
  "saju_daily_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    forDate: date("for_date").notNull(),
    frameHash: text("frame_hash").notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: integer("prompt_version").notNull().default(1),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    narrativeText: text("narrative_text").notNull(),
    sectionsJsonb: jsonb("sections_jsonb").$type<MonthlyNarrativeSections>(),
    schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),
    citations: text("citations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_daily_narrative_profile_idx").on(t.profileId, t.forDate),
    uniqueIndex("saju_daily_narrative_cache_key").on(
      t.profileId,
      t.school,
      t.forDate,
      t.frameHash,
      t.modelId,
      t.promptVersion,
      t.algorithmVersion,
    ),
  ],
);

export type SajuDailyNarrativeRow = typeof sajuDailyNarrative.$inferSelect;
