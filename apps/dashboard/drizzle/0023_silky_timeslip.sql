CREATE TABLE "stock_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"persona" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "stock_analysis_runs" ADD CONSTRAINT "stock_analysis_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_runs_user_symbol_idx" ON "stock_analysis_runs" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_runs_in_flight_uq" ON "stock_analysis_runs" USING btree ("user_id","symbol","persona") WHERE "stock_analysis_runs"."status" IN ('queued', 'running');