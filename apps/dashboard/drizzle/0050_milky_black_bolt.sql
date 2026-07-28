CREATE TABLE "remediation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"dedup_key" text NOT NULL,
	"policy_id" text NOT NULL,
	"action" text NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"detail" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "remediation_attempts" ADD CONSTRAINT "remediation_attempts_event_id_monitoring_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."monitoring_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "remediation_attempts_dedup_idx" ON "remediation_attempts" USING btree ("dedup_key","attempted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "remediation_in_flight_uq" ON "remediation_attempts" USING btree ("dedup_key") WHERE outcome = 'in_flight';