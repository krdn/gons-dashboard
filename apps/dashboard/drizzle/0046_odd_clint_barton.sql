CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" text NOT NULL,
	"total" integer NOT NULL,
	"succeeded" integer NOT NULL,
	"failed" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" real NOT NULL,
	"labels" jsonb,
	"collected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"dedup_key" text NOT NULL,
	"host_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_runs_job_time_idx" ON "cron_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "metric_samples_host_metric_time_idx" ON "metric_samples" USING btree ("host_id","metric","collected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "metric_samples_time_idx" ON "metric_samples" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "monitoring_events_dedup_idx" ON "monitoring_events" USING btree ("dedup_key","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "monitoring_events_time_idx" ON "monitoring_events" USING btree ("occurred_at" DESC NULLS LAST);