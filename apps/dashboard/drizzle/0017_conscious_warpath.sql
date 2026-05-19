DROP INDEX "saju_monthly_narrative_cache_key";--> statement-breakpoint
DROP INDEX "saju_yearly_narrative_cache_key";--> statement-breakpoint
ALTER TABLE "saju_monthly_narrative" ADD COLUMN "prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_monthly_narrative" ADD COLUMN "school_specific_jsonb" jsonb;--> statement-breakpoint
ALTER TABLE "saju_yearly_narrative" ADD COLUMN "prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_yearly_narrative" ADD COLUMN "school_specific_jsonb" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "saju_monthly_narrative_cache_key" ON "saju_monthly_narrative" USING btree ("profile_id","school","target_year","target_month","frame_hash","model_id","prompt_version","algorithm_version");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_yearly_narrative_cache_key" ON "saju_yearly_narrative" USING btree ("profile_id","school","target_year","frame_hash","model_id","prompt_version","algorithm_version");