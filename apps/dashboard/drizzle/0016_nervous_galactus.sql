CREATE TABLE "saju_daily_narrative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"school" text NOT NULL,
	"for_date" date NOT NULL,
	"frame_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"algorithm_version" integer DEFAULT 1 NOT NULL,
	"narrative_text" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saju_daily_tri" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"for_date" date NOT NULL,
	"input_hash" text NOT NULL,
	"schema_version" integer NOT NULL,
	"algorithm_version" integer DEFAULT 1 NOT NULL,
	"frame_jsonb" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saju_monthly_narrative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"school" text NOT NULL,
	"target_year" integer NOT NULL,
	"target_month" integer NOT NULL,
	"frame_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"algorithm_version" integer DEFAULT 1 NOT NULL,
	"narrative_text" text NOT NULL,
	"sections_jsonb" jsonb NOT NULL,
	"citations" text[] DEFAULT '{}'::text[] NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saju_monthly_tri" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"school" text NOT NULL,
	"target_year" integer NOT NULL,
	"target_month" integer NOT NULL,
	"input_hash" text NOT NULL,
	"schema_version" integer NOT NULL,
	"algorithm_version" integer DEFAULT 1 NOT NULL,
	"frame_jsonb" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saju_daily_narrative" ADD CONSTRAINT "saju_daily_narrative_profile_id_fortune_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fortune_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saju_daily_tri" ADD CONSTRAINT "saju_daily_tri_profile_id_fortune_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fortune_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saju_monthly_narrative" ADD CONSTRAINT "saju_monthly_narrative_profile_id_fortune_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fortune_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saju_monthly_tri" ADD CONSTRAINT "saju_monthly_tri_profile_id_fortune_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fortune_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saju_daily_narrative_profile_idx" ON "saju_daily_narrative" USING btree ("profile_id","for_date");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_daily_narrative_cache_key" ON "saju_daily_narrative" USING btree ("profile_id","school","for_date","frame_hash","model_id","algorithm_version");--> statement-breakpoint
CREATE INDEX "saju_daily_tri_date_idx" ON "saju_daily_tri" USING btree ("for_date");--> statement-breakpoint
CREATE INDEX "saju_daily_tri_profile_idx" ON "saju_daily_tri" USING btree ("profile_id","for_date");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_daily_tri_cache_key" ON "saju_daily_tri" USING btree ("profile_id","for_date","input_hash","schema_version","algorithm_version");--> statement-breakpoint
CREATE INDEX "saju_monthly_narrative_profile_idx" ON "saju_monthly_narrative" USING btree ("profile_id","target_year","target_month");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_monthly_narrative_cache_key" ON "saju_monthly_narrative" USING btree ("profile_id","school","target_year","target_month","frame_hash","model_id","algorithm_version");--> statement-breakpoint
CREATE INDEX "saju_monthly_tri_profile_idx" ON "saju_monthly_tri" USING btree ("profile_id","target_year","target_month");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_monthly_tri_cache_key" ON "saju_monthly_tri" USING btree ("profile_id","school","target_year","target_month","input_hash","schema_version","algorithm_version");--> statement-breakpoint
-- v0.3 school CHECK — 한·중(자평/맹파)·일 4학파 (drizzle-kit 미지원, 수동 append)
ALTER TABLE "saju_monthly_tri"
  ADD CONSTRAINT "saju_monthly_tri_school_check"
  CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp'));--> statement-breakpoint
ALTER TABLE "saju_monthly_narrative"
  ADD CONSTRAINT "saju_monthly_narrative_school_check"
  CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp'));--> statement-breakpoint
ALTER TABLE "saju_daily_narrative"
  ADD CONSTRAINT "saju_daily_narrative_school_check"
  CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp'));--> statement-breakpoint
-- target_month 범위 CHECK (1..12)
ALTER TABLE "saju_monthly_tri"
  ADD CONSTRAINT "saju_monthly_tri_target_month_check"
  CHECK (target_month BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "saju_monthly_narrative"
  ADD CONSTRAINT "saju_monthly_narrative_target_month_check"
  CHECK (target_month BETWEEN 1 AND 12);
