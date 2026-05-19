DROP INDEX "saju_lifetime_tri_cache_key";--> statement-breakpoint
ALTER TABLE "saju_lifetime_tri" ADD COLUMN "algorithm_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "saju_lifetime_tri_cache_key" ON "saju_lifetime_tri" USING btree ("profile_id","school","input_hash","schema_version","algorithm_version");