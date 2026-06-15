// Email 도메인 — entities/email.
// - email_threads: Gmail thread 메타
// - reply_needed: 답장 필요 (partial index reply_needed_open_idx)
// - important_emails: 중요 이메일 위젯 소스
// - push_subscriptions: web-push 구독 (이메일 다이제스트·플립 알림 공용)
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  jsonb,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import type { Category } from "@/entities/email/model/types";

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

/* 답장 필요 — entities/email (plan-eng-review에서 features → entities로 이동)
 * 인덱스: reply_needed_open_idx (partial) */
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

/* 중요 이메일 — entities/email (별도 위젯 widgets/important-emails)
 * D6: 답장 필요 활성 시 위젯에서 LEFT JOIN으로 숨김 (read 시점 정책) */
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

/* Push 구독 — web-push (VAPID). 이메일 다이제스트·종목 플립 알림 공용. */
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

/* Email 위젯 사용자 설정 — entities/email-settings.
 * user당 1행(userId PK). row 없으면 코드의 EMAIL_SETTINGS_DEFAULTS 사용.
 * 모든 default는 현재 하드코딩 값과 동일 — 미설정 사용자 동작 불변. */
export const emailSettings = pgTable("email_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // 조회 시점 설정 (저장 즉시 위젯 반영)
  replyNeededLimit: integer("reply_needed_limit").notNull().default(5),
  importantLimit: integer("important_limit").notNull().default(10),
  windowDays: integer("window_days").notNull().default(7),

  // 알림 임계값
  replySeverityThreshold: text("reply_severity_threshold")
    .notNull()
    .default("med"), // 'high' | 'med' | 'low'
  importantThreshold: text("important_threshold").notNull().default("med"), // 'high' | 'med'

  // important 카테고리 필터 (보여줄 카테고리)
  categories: jsonb("categories")
    .$type<Category[]>()
    .notNull()
    .default(["money", "security", "schedule", "notice"]),

  // LLM 분류 on/off
  llmReplyEnabled: boolean("llm_reply_enabled").notNull().default(true),
  llmImportantEnabled: boolean("llm_important_enabled").notNull().default(true),

  // 동기화 주기 / 다이제스트 (cron이 실행 시점에 읽음)
  syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(60),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  digestHourKst: integer("digest_hour_kst").notNull().default(8), // 0-23
  lastDigestSentDate: date("last_digest_sent_date"), // 'YYYY-MM-DD' KST, due 멱등성

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
