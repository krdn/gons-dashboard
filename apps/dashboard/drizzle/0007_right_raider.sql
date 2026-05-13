CREATE TABLE "llm_spend_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"krw" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saju_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"year_stem" text NOT NULL,
	"year_branch" text NOT NULL,
	"month_stem" text NOT NULL,
	"month_branch" text NOT NULL,
	"day_stem" text NOT NULL,
	"day_branch" text NOT NULL,
	"hour_stem" text,
	"hour_branch" text,
	"elements" jsonb NOT NULL,
	"strength" text NOT NULL,
	"ten_gods" jsonb NOT NULL,
	"pattern" text NOT NULL,
	"yong_sin" jsonb NOT NULL,
	"gi_sin" jsonb NOT NULL,
	"major_fortunes" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saju_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_id" uuid NOT NULL,
	"section" text NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saju_charts" ADD CONSTRAINT "saju_charts_profile_id_fortune_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fortune_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saju_readings" ADD CONSTRAINT "saju_readings_chart_id_saju_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."saju_charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_spend_log_feature_day_idx" ON "llm_spend_log" USING btree ("feature","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_charts_profile_idx" ON "saju_charts" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_readings_chart_section_idx" ON "saju_readings" USING btree ("chart_id","section");