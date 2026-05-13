CREATE TABLE "saju_daily_fortunes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_id" uuid NOT NULL,
	"for_date" date NOT NULL,
	"day_stem" text NOT NULL,
	"day_branch" text NOT NULL,
	"payload" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saju_yearly_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"year_stem" text NOT NULL,
	"year_branch" text NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saju_daily_fortunes" ADD CONSTRAINT "saju_daily_fortunes_chart_id_saju_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."saju_charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saju_yearly_readings" ADD CONSTRAINT "saju_yearly_readings_chart_id_saju_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."saju_charts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saju_daily_fortunes_chart_date_idx" ON "saju_daily_fortunes" USING btree ("chart_id","for_date");--> statement-breakpoint
CREATE INDEX "saju_daily_fortunes_date_idx" ON "saju_daily_fortunes" USING btree ("for_date");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_yearly_readings_chart_year_idx" ON "saju_yearly_readings" USING btree ("chart_id","year");