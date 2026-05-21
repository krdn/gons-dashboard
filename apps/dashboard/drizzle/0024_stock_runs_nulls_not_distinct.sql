DROP INDEX IF EXISTS "stock_runs_in_flight_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_runs_in_flight_uq" ON "stock_analysis_runs" USING btree ("user_id","symbol","persona") NULLS NOT DISTINCT WHERE "stock_analysis_runs"."status" IN ('queued', 'running');
