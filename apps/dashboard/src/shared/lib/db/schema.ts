// Drizzle 스키마 — 디자인 문서 §"DB 스키마 (요약)"의 구현.
// 인덱스·제약은 plan-eng-review의 결정 반영:
//  - reply_needed_open_idx: partial index for "오픈 상태"
//  - users.oauth_state: 'active' | 'reauth_required'
//  - users.last_history_id: Gmail History API incremental polling
//
// FSD: 이 파일은 shared/lib/db (모든 도메인이 공유하는 인프라). 도메인별 모델 타입은
// entities/<domain>/model/*.ts 에서 export하고, 이 스키마를 import하여 사용한다.
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  primaryKey,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  numeric,
  date,
  customType,
} from "drizzle-orm/pg-core";

/* =========================================================================
 * Auth.js v5 표준 테이블 (DrizzleAdapter 사양)
 * https://authjs.dev/getting-started/adapters/drizzle
 * ========================================================================= */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),

  // Gmail polling 상태
  lastHistoryId: text("last_history_id"),
  oauthState: text("oauth_state").notNull().default("active"), // 'active' | 'reauth_required'
  tokenExpiredAt: timestamp("token_expired_at", { mode: "date" }),
  lastSyncAt: timestamp("last_sync_at", { mode: "date" }),
});

// 키 이름이 snake_case인 이유: @auth/drizzle-adapter의 DefaultPostgresAccountsTable
// 타입이 컬럼 객체 키를 snake_case로 강제. 우리 자체 도메인 테이블은 camelCase 유지.
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* =========================================================================
 * Email 도메인 — entities/email
 * ========================================================================= */
export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailThreadId: text("gmail_thread_id").notNull(),
    subject: text("subject"),
    lastSenderEmail: text("last_sender_email"),
    lastSenderName: text("last_sender_name"),
    lastReceivedAt: timestamp("last_received_at", { mode: "date" }),
    snippet: text("snippet"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_threads_user_thread_idx").on(t.userId, t.gmailThreadId),
    index("email_threads_user_received_idx").on(t.userId, t.lastReceivedAt),
  ],
);

/* =========================================================================
 * 답장 필요 — entities/email (plan-eng-review에서 features → entities로 이동)
 * 인덱스: reply_needed_open_idx (partial)
 * ========================================================================= */
export const replyNeeded = pgTable(
  "reply_needed",
  {
    threadId: uuid("thread_id")
      .primaryKey()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    severity: text("severity").notNull(), // 'high' | 'med' | 'low'
    classifierVersion: text("classifier_version").notNull(), // ex: 'v1.0-haiku-deterministic'
    classifiedBy: text("classified_by").notNull(), // 'deterministic' | 'llm-haiku'
    classifiedAt: timestamp("classified_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    repliedAt: timestamp("replied_at", { mode: "date" }),
    dismissedAt: timestamp("dismissed_at", { mode: "date" }),
    // user_action: 'replied' | 'dismissed' | 'none' — eval CI의 ground truth
    userAction: text("user_action").notNull().default("none"),
    userActionAt: timestamp("user_action_at", { mode: "date" }),
  },
  (t) => [
    // 메인 조회: WHERE replied_at IS NULL AND dismissed_at IS NULL ORDER BY classified_at DESC
    index("reply_needed_open_idx")
      .on(t.severity, t.classifiedAt.desc())
      .where(sql`${t.repliedAt} IS NULL AND ${t.dismissedAt} IS NULL`),
  ],
);

/* =========================================================================
 * 중요 이메일 — entities/email (별도 위젯 widgets/important-emails)
 * D6: 답장 필요 활성 시 위젯에서 LEFT JOIN으로 숨김 (read 시점 정책)
 * ========================================================================= */
export const importantEmails = pgTable(
  "important_emails",
  {
    threadId: uuid("thread_id")
      .primaryKey()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // 'money' | 'security' | 'schedule' | 'notice'
    importance: text("importance").notNull(), // 'high' | 'med'
    summary: text("summary").notNull(), // ≤ 200자 한국어
    rationale: text("rationale").notNull(), // 디버깅·eval용
    classifierVersion: text("classifier_version").notNull(),
    classifiedBy: text("classified_by").notNull(), // 'llm-haiku'
    classifiedAt: timestamp("classified_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { mode: "date" }),
    archivedAt: timestamp("archived_at", { mode: "date" }),
  },
  (t) => [
    index("important_emails_open_idx")
      .on(t.userId, t.importance, t.classifiedAt.desc())
      .where(sql`${t.readAt} IS NULL AND ${t.archivedAt} IS NULL`),
  ],
);

/* =========================================================================
 * Push 구독
 * ========================================================================= */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/* =========================================================================
 * 서버 인프라 모니터 v0.1 — entities/host · entities/project · audit_logs
 * - hosts: 등록된 docker context (다호스트 확장 대비, v0.1엔 home-server 1대)
 * - projects: compose project 메타데이터 (display name, 카테고리, pinned)
 * - audit_logs: 컨테이너 액션 이력 (read+admin 기록)
 * ========================================================================= */
export const hosts = pgTable("hosts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // "home-server"
  dockerContext: text("docker_context").notNull(), // docker CLI --context 인자
  // 호스트 IPv4 (선택). 0004 마이그레이션으로 추가. 현재 src/ 에서는 미사용이지만
  // 운영 DB·snapshot 정합을 위해 schema에 유지. 향후 디스플레이/연결 진단용.
  ip: text("ip"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    composeProject: text("compose_project").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    category: text("category"), // 'news' | 'ai' | 'infra' | 'experiment' | null
    url: text("url"),
    isPinned: boolean("is_pinned").notNull().default(false),
    isHidden: boolean("is_hidden").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_host_compose_idx").on(t.hostId, t.composeProject),
    index("projects_visible_idx").on(t.hostId, t.isHidden, t.isPinned),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id),
    containerId: text("container_id").notNull(),
    containerName: text("container_name").notNull(),
    action: text("action").notNull(), // 'restart' | 'start' | 'stop'
    userEmail: text("user_email").notNull(), // NextAuth session.user.email
    status: text("status").notNull(), // 'success' | 'failed'
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // 호스트별 최근 액션 조회: WHERE host_id = ? ORDER BY created_at DESC LIMIT 5
    index("audit_logs_host_recent_idx").on(t.hostId, t.createdAt.desc()),
  ],
);

/* =========================================================================
 * 사주 프로필 — entities/fortune-profile · widgets/fortune (다인 지원)
 * - 본인·가족·지인 등 여러 사람의 사주 정보를 보관, FortuneCard 셀렉터의 소스.
 * - 한자 이름은 추후 성명학 분석 확장을 위해 미리 컬럼 확보.
 * - birthDate를 date 타입 대신 text("YYYY-MM-DD")로 둔 이유: 음력 입력 시
 *   timezone/달력 변환 혼선을 피하고 PlayMCP에 원문 그대로 넘기기 위함.
 * ========================================================================= */
export const fortuneProfiles = pgTable(
  "fortune_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameHanja: text("name_hanja"),
    // 'self' | 'spouse' | 'child' | 'parent' | 'sibling' | 'relative' | 'friend' | 'other'
    relation: text("relation").notNull(),
    birthDate: text("birth_date").notNull(), // 'YYYY-MM-DD' (입력값 그대로)
    calendar: text("calendar").notNull().default("solar"), // 'solar' | 'lunar'
    gender: text("gender").notNull(), // 'male' | 'female'
    birthTime: text("birth_time"), // 'HH:MM'
    birthCity: text("birth_city"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("fortune_profiles_user_idx").on(t.userId)],
);

/* =========================================================================
 * 사주 상세 — Phase 1 spec §4
 * - saju_charts: 원국 (결정적). profile_id UNIQUE, input_hash 불일치 시 무효화.
 * - saju_readings: 섹션별 LLM 해설. model 컬럼으로 모델 변경 시 일괄 무효화.
 * - llm_spend_log: feature='saju' 일별 KRW 합산. 미래 LLM 기능 공용.
 * ========================================================================= */
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
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saju_charts_profile_idx").on(t.profileId)],
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

/* =========================================================================
 * 사주 Phase 3 — spec §4
 * - saju_yearly_readings: 세운+월운 lazy 캐시 ((chart_id, year) UNIQUE)
 * - saju_daily_fortunes: 매일 자정 cron 일괄 + 영구 보관 ((chart_id, for_date) UNIQUE)
 * ========================================================================= */
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

/* =========================================================================
 * 호(虎) 상담 영역 — PlayMCP 1FATE (spec: 2026-05-15-tiger-playmcp-area-design.md)
 * - playmcp_profiles      : 호 상담 전용 프로필 (fortune_profiles 와 독립)
 * - playmcp_analysis      : analyze_saju 캐시 (profile_id UNIQUE)
 * - playmcp_yearly        : get_year_fortune 캐시 ((profile_id, year) UNIQUE)
 * - playmcp_daily         : get_daily_fortune 캐시 ((profile_id, for_date_kst) UNIQUE)
 * - playmcp_compatibility : check_compatibility 캐시 (profile1<profile2 CHECK)
 * - playmcp_credentials   : OAuth 토큰 단일 row (pgcrypto 암호화)
 * ========================================================================= */
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
