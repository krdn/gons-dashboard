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

  // Sprint 2 — Gmail polling 상태
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
