DROP INDEX "saju_daily_narrative_cache_key";--> statement-breakpoint
ALTER TABLE "saju_daily_narrative" ADD COLUMN "prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_daily_narrative" ADD COLUMN "sections_jsonb" jsonb;--> statement-breakpoint
ALTER TABLE "saju_daily_narrative" ADD COLUMN "school_specific_jsonb" jsonb;--> statement-breakpoint
ALTER TABLE "saju_daily_narrative" ADD COLUMN "citations" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "saju_daily_narrative_cache_key" ON "saju_daily_narrative" USING btree ("profile_id","school","for_date","frame_hash","model_id","prompt_version","algorithm_version");--> statement-breakpoint
-- v0.3.x daily narrative richer 보강: 기존 plain-text row 청소 후 새 모델로 lazy regen.
-- prompt_version=1 캐시 키 충돌 회피 (sections_jsonb NULL row 와 신규 row 가 같은 키를 만드는 것 차단).
DELETE FROM "saju_daily_narrative";
