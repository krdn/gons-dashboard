DROP INDEX IF EXISTS "stock_cache_lookup_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_cache_lookup_uq" ON "stock_analysis_cache" USING btree ("symbol","analysis_date","user_id") NULLS NOT DISTINCT;
