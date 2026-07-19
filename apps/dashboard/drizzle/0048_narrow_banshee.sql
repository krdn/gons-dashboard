CREATE TABLE "check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb,
	"host_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD COLUMN "resolved_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_results_kind_target_time_idx" ON "check_results" USING btree ("kind","target","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "check_results_time_idx" ON "check_results" USING btree ("checked_at");