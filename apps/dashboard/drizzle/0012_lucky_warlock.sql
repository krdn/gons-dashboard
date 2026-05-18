CREATE TABLE "saju_yearly_narrative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"school" text NOT NULL,
	"target_year" integer NOT NULL,
	"frame_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"narrative_text" text NOT NULL,
	"sections_jsonb" jsonb NOT NULL,
	"citations" text[] DEFAULT '{}'::text[] NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saju_yearly_tri" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"school" text NOT NULL,
	"target_year" integer NOT NULL,
	"input_hash" text NOT NULL,
	"schema_version" integer NOT NULL,
	"frame_jsonb" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saju_yearly_narrative" ADD CONSTRAINT "saju_yearly_narrative_profile_id_fortune_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fortune_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saju_yearly_tri" ADD CONSTRAINT "saju_yearly_tri_profile_id_fortune_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."fortune_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saju_yearly_narrative_profile_idx" ON "saju_yearly_narrative" USING btree ("profile_id","target_year");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_yearly_narrative_cache_key" ON "saju_yearly_narrative" USING btree ("profile_id","school","target_year","frame_hash","model_id");--> statement-breakpoint
CREATE INDEX "saju_yearly_tri_profile_idx" ON "saju_yearly_tri" USING btree ("profile_id","target_year");--> statement-breakpoint
CREATE UNIQUE INDEX "saju_yearly_tri_cache_key" ON "saju_yearly_tri" USING btree ("profile_id","school","target_year","input_hash","schema_version");--> statement-breakpoint
-- school enum CHECK — 한·중(자평/맹파)·일 + compose (drizzle-kit 미지원, 수동 append)
ALTER TABLE "saju_yearly_tri"
  ADD CONSTRAINT "saju_yearly_tri_school_check"
  CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp', 'compose'));--> statement-breakpoint
-- narrative 는 단일 학파만 (compose 제외)
ALTER TABLE "saju_yearly_narrative"
  ADD CONSTRAINT "saju_yearly_narrative_school_check"
  CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp'));