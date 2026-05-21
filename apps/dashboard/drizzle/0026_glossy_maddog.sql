-- pg_trgm: ILIKE '%주성%' 빠른 검색용 GIN 인덱스 사전 조건
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "stock_master" (
	"symbol" text PRIMARY KEY NOT NULL,
	"krx_code" text NOT NULL,
	"korean_name" text NOT NULL,
	"english_name" text,
	"market_category" text NOT NULL,
	"security_type" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delisted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_symbol_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"krx_code" text NOT NULL,
	"from_symbol" text NOT NULL,
	"to_symbol" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"affected_holdings" integer DEFAULT 0 NOT NULL,
	"invalidated_cache_rows" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- NOTE: drizzle-kit generate 가 stock_consensus_flips.detected_date 와 flips_dedup_uq
-- 를 같이 잡았으나 이는 0025_wonderful_vengeance.sql 에서 이미 운영에 적용된 변경.
-- 0025_snapshot.json 에 컬럼 정의가 누락되어 발생한 drift catchup 이므로 SQL 에서는 제거.
-- 0026_snapshot.json 은 최신 truth 로 유지 → 다음 generate 부터 drift 재발 없음.
CREATE INDEX "stock_master_krx_code_idx" ON "stock_master" USING btree ("krx_code");--> statement-breakpoint
CREATE INDEX "stock_master_korean_name_trgm_idx" ON "stock_master" USING gin ("korean_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "stock_master_market_active_idx" ON "stock_master" USING btree ("market_category","delisted");--> statement-breakpoint
CREATE INDEX "stock_symbol_migrations_detected_idx" ON "stock_symbol_migrations" USING btree ("detected_at" DESC NULLS LAST);