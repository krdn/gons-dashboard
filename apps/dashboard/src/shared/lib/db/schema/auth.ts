// Auth 도메인 — Auth.js v5 표준 테이블 (DrizzleAdapter 사양) + Gmail polling 상태.
// FSD: shared/lib/db (모든 도메인이 공유하는 인프라). 다른 schema 도메인 파일이
// users 를 FK 대상으로 import 한다.
// https://authjs.dev/getting-started/adapters/drizzle
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  primaryKey,
} from "drizzle-orm/pg-core";

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
