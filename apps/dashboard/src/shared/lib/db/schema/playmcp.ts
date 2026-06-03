// 호(虎) 상담 영역 — PlayMCP 1FATE (spec: 2026-05-15-tiger-playmcp-area-design.md)
// - playmcp_profiles      : 호 상담 전용 프로필 (fortune_profiles 와 독립)
// - playmcp_analysis      : analyze_saju 캐시 (profile_id UNIQUE)
// - playmcp_yearly        : get_year_fortune 캐시 ((profile_id, year) UNIQUE)
// - playmcp_daily         : get_daily_fortune 캐시 ((profile_id, for_date_kst) UNIQUE)
// - playmcp_compatibility : check_compatibility 캐시 (profile1<profile2 CHECK)
// - playmcp_credentials   : OAuth 토큰 단일 row (pgcrypto 암호화)
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  date,
  customType,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const playmcpProfiles = pgTable(
  "playmcp_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    relation: text("relation").notNull(),
    birthDate: text("birth_date").notNull(),
    calendar: text("calendar").notNull().default("solar"), // 'solar' | 'lunar'
    gender: text("gender").notNull(), // 'male' | 'female'
    birthTime: text("birth_time"),
    birthCity: text("birth_city"),
    inputHash: text("input_hash").notNull(), // sha256(birthDate|calendar|gender|birthTime|birthCity) — 캐시 무효화 키
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("playmcp_profiles_user_idx").on(t.userId)],
);

export const playmcpAnalysis = pgTable(
  "playmcp_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("playmcp_analysis_profile_idx").on(t.profileId)],
);

export const playmcpYearly = pgTable(
  "playmcp_yearly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    inputHash: text("input_hash").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playmcp_yearly_profile_year_idx").on(t.profileId, t.year),
  ],
);

export const playmcpDaily = pgTable(
  "playmcp_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    forDateKst: date("for_date_kst").notNull(),
    inputHash: text("input_hash").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playmcp_daily_profile_date_idx").on(t.profileId, t.forDateKst),
    index("playmcp_daily_date_idx").on(t.forDateKst),
  ],
);

// CHECK (profile1_id < profile2_id) 는 마이그레이션 SQL 후처리(ALTER TABLE) 로
// 적용한다 — 순서 무관 쌍 키를 application 측 정렬과 함께 강제.
export const playmcpCompatibility = pgTable(
  "playmcp_compatibility",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profile1Id: uuid("profile1_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    profile2Id: uuid("profile2_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    inputHash1: text("input_hash1").notNull(),
    inputHash2: text("input_hash2").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playmcp_compat_pair_idx").on(t.profile1Id, t.profile2Id),
  ],
);

// 단일 row 강제는 application 측에서 (CHECK 제약은 row-level 단일성 강제 불가).
// access_token / refresh_token 은 AES-256-GCM 으로 암호화된 bytea.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const playmcpCredentials = pgTable("playmcp_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessTokenEnc: bytea("access_token_enc").notNull(),
  refreshTokenEnc: bytea("refresh_token_enc").notNull(),
  accessExpiresAt: timestamp("access_expires_at", { mode: "date" }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { mode: "date" }).notNull(),
  clientId: text("client_id").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
