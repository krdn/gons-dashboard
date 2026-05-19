DROP INDEX "saju_charts_profile_idx";--> statement-breakpoint
DROP INDEX "saju_lifetime_narrative_cache_key";--> statement-breakpoint
DROP INDEX "saju_yearly_narrative_cache_key";--> statement-breakpoint
DROP INDEX "saju_yearly_tri_cache_key";--> statement-breakpoint
ALTER TABLE "saju_charts" ADD COLUMN "algorithm_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_lifetime_narrative" ADD COLUMN "algorithm_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_yearly_narrative" ADD COLUMN "algorithm_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_yearly_tri" ADD COLUMN "algorithm_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "saju_charts_profile_idx" ON "saju_charts" USING btree ("profile_id","input_hash","algorithm_version");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_lifetime_narrative_cache_key" ON "saju_lifetime_narrative" USING btree ("profile_id","school","frame_hash","model_id","prompt_version","algorithm_version");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_yearly_narrative_cache_key" ON "saju_yearly_narrative" USING btree ("profile_id","school","target_year","frame_hash","model_id","algorithm_version");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_yearly_tri_cache_key" ON "saju_yearly_tri" USING btree ("profile_id","school","target_year","input_hash","schema_version","algorithm_version");