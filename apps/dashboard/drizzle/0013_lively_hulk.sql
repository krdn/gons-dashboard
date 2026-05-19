DROP INDEX "saju_lifetime_narrative_cache_key";--> statement-breakpoint
ALTER TABLE "saju_lifetime_narrative" ADD COLUMN "prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_lifetime_narrative" ADD COLUMN "school_specific_jsonb" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "saju_lifetime_narrative_cache_key" ON "saju_lifetime_narrative" USING btree ("profile_id","school","frame_hash","model_id","prompt_version");