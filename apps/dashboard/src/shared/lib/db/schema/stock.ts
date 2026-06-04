// stock-analysis 위젯 — entities/portfolio + entities/stock-analysis + entities/stock-master
// 디자인 spec: docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md §4
import { sql } from "drizzle-orm";
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
  numeric,
  date,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const portfolioHoldings = pgTable(
  "portfolio_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class").notNull(), // 'stock' | 'etf' | 'crypto' 등
    market: text("market").notNull(), // 'US' | 'KR' | 'CRYPTO' 등
    displayName: text("display_name").notNull(),
    // watchlist 일 때 NULL 허용 — CHECK 로 강제
    quantity: numeric("quantity", { precision: 20, scale: 8 }),
    avgCost: numeric("avg_cost", { precision: 20, scale: 8 }),
    purchasedAt: date("purchased_at"),
    // kind: 'holding' (실제 보유) | 'watchlist' (관심만)
    kind: text("kind").notNull().default("holding"),
    // flip 푸시 알림 토글 — 보유 기본 true, 관심 기본 false (server action 에서 분기)
    pushOptIn: boolean("push_opt_in").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("portfolio_holdings_user_symbol_uq").on(t.userId, t.symbol),
    index("portfolio_holdings_user_idx").on(t.userId),
    check(
      "portfolio_holdings_kind_check",
      sql`${t.kind} IN ('holding', 'watchlist')`,
    ),
    check(
      "portfolio_holdings_holding_qty_check",
      sql`(${t.kind} = 'watchlist') OR (${t.quantity} IS NOT NULL AND ${t.avgCost} IS NOT NULL)`,
    ),
  ],
);

export const stockPersonaPreferences = pgTable("stock_persona_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // 페르소나별 모델 선호 오버라이드: { fundamentalist: 'claude', technician: 'codex', ... }
  overrides: jsonb("overrides")
    .$type<Record<string, "claude" | "codex" | "gemini">>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stockAnalysisCache = pgTable(
  "stock_analysis_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: text("symbol").notNull(),
    analysisDate: date("analysis_date").notNull(),
    // userId nullable: 글로벌 캐시(공용) 와 user-specific 캐시 모두 허용
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    personas: jsonb("personas").notNull(),
    consensus: jsonb("consensus").notNull(),
    marketSnapshot: jsonb("market_snapshot").notNull(),
    promptVersion: text("prompt_version").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("stock_cache_lookup_uq").on(t.symbol, t.analysisDate, t.userId),
    index("stock_cache_lookup_idx").on(t.userId, t.symbol, t.analysisDate),
  ],
);

export const stockConsensusFlips = pgTable(
  "stock_consensus_flips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    fromVerdict: text("from_verdict").notNull(),
    toVerdict: text("to_verdict").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
    // 24h dedup 용 generated column — DB 가 detected_at 에서 KST 자정 기준 date 자동 산출.
    // (detected_at AT TIME ZONE 'Asia/Seoul')::date STORED — IMMUTABLE 만족.
    // GENERATED ALWAYS AS STORED — 코드 INSERT 시 명시 금지 (DB 가 자동 채움).
    detectedDate: date("detected_date").generatedAlwaysAs(
      sql`((detected_at AT TIME ZONE 'Asia/Seoul')::date)`,
    ),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    // 미전송 flip 큐 조회용 partial index
    index("flips_pending_idx").on(t.notifiedAt).where(sql`${t.notifiedAt} IS NULL`),
    // 24h 1회 cap (spec §2.1 #4) — 같은 (user, symbol) 의 같은 KST 날짜 detection 단 1회.
    // INSERT 시 unique violation 발생하면 cron 이 catch + skip (이미 알림 보냄).
    uniqueIndex("flips_dedup_uq").on(t.userId, t.symbol, t.detectedDate),
  ],
);

// Phase 6: lazy trigger 진행 상태 추적.
// partial unique index 로 같은 (user, symbol, persona) in-flight 중복 trigger 차단 →
// API 라우트에서 unique violation catch 후 기존 run id 반환하여 idempotent 보장.
export const stockAnalysisRuns = pgTable(
  "stock_analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    persona: text("persona"), // NULL = 전체 분석, persona 키 = 그 페르소나만
    status: text("status").notNull(), // 'queued' | 'running' | 'completed' | 'failed'
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("stock_runs_user_symbol_idx").on(t.userId, t.symbol),
    uniqueIndex("stock_runs_in_flight_uq")
      .on(t.userId, t.symbol, t.persona)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);

/* KRX 종목 마스터 — entities/stock-master + features/krx-master-sync
 * 한글 검색을 위한 종목 마스터. 주 1회 일요일 06:00 KST cron 으로 갱신.
 * pg_trgm GIN 인덱스로 ILIKE '%주성%' <5ms. */
export const stockMaster = pgTable(
  "stock_master",
  {
    symbol: text("symbol").primaryKey(), // "005930.KS", "036930.KQ"
    krxCode: text("krx_code").notNull(), // "005930"
    koreanName: text("korean_name").notNull(), // "삼성전자"
    englishName: text("english_name"), // "Samsung Electronics Co Ltd"
    marketCategory: text("market_category").notNull(), // 'KOSPI' | 'KOSDAQ'
    securityType: text("security_type").notNull(), // 'EQUITY' | 'ETF' | 'ETN' | 'REIT' | 'SPAC'
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    delisted: boolean("delisted").notNull().default(false),
  },
  (t) => [
    index("stock_master_krx_code_idx").on(t.krxCode),
    // pg_trgm GIN — ILIKE '%주성%' 빠른 검색 (4,000 row 에서 <5ms)
    index("stock_master_korean_name_trgm_idx").using(
      "gin",
      sql`${t.koreanName} gin_trgm_ops`,
    ),
    index("stock_master_market_active_idx").on(t.marketCategory, t.delisted),
  ],
);

// 이전상장 회수 audit log. 예: 066970.KQ → 066970.KS (엘앤에프 KOSDAQ→KOSPI 이전).
export const stockSymbolMigrations = pgTable(
  "stock_symbol_migrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    krxCode: text("krx_code").notNull(),
    fromSymbol: text("from_symbol").notNull(),
    toSymbol: text("to_symbol").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    affectedHoldings: integer("affected_holdings").notNull().default(0),
    invalidatedCacheRows: integer("invalidated_cache_rows").notNull().default(0),
  },
  (t) => [
    index("stock_symbol_migrations_detected_idx").on(t.detectedAt.desc()),
  ],
);

// 주식 타임프레임 분석 이력 (@krdn/tickerlens — 페르소나×타임프레임, 집계 없음)
// 기존 stock_analysis_cache(페르소나×verdict+consensus)와 별개 도메인.
export const stockTimeframeAnalyses = pgTable("stock_timeframe_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  depth: text("depth").notNull(), // 'full' | 'lite'
  asOf: timestamp("as_of").notNull(),
  result: jsonb("result").notNull(), // tickerlens AnalysisResult 전체
  costUsd: numeric("cost_usd"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
