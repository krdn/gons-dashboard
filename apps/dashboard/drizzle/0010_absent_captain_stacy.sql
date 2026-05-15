-- PlayMCP 토큰 암호화를 위해. application 측 AES 외에도 추후 pgp_sym_encrypt
-- 가 필요할 수 있어 extension 활성화.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TABLE "playmcp_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"validated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playmcp_compatibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile1_id" uuid NOT NULL,
	"profile2_id" uuid NOT NULL,
	"input_hash1" text NOT NULL,
	"input_hash2" text NOT NULL,
	"payload" jsonb NOT NULL,
	"validated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playmcp_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_token_enc" "bytea" NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"access_expires_at" timestamp NOT NULL,
	"refresh_expires_at" timestamp NOT NULL,
	"client_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playmcp_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"for_date_kst" date NOT NULL,
	"input_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"validated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playmcp_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"relation" text NOT NULL,
	"birth_date" text NOT NULL,
	"calendar" text DEFAULT 'solar' NOT NULL,
	"gender" text NOT NULL,
	"birth_time" text,
	"birth_city" text,
	"input_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playmcp_yearly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"input_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"validated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saju_daily_fortunes" ALTER COLUMN "prompt_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "saju_readings" ALTER COLUMN "prompt_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "saju_yearly_readings" ALTER COLUMN "prompt_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "playmcp_analysis" ADD CONSTRAINT "playmcp_analysis_profile_id_playmcp_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."playmcp_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playmcp_compatibility" ADD CONSTRAINT "playmcp_compatibility_profile1_id_playmcp_profiles_id_fk" FOREIGN KEY ("profile1_id") REFERENCES "public"."playmcp_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playmcp_compatibility" ADD CONSTRAINT "playmcp_compatibility_profile2_id_playmcp_profiles_id_fk" FOREIGN KEY ("profile2_id") REFERENCES "public"."playmcp_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playmcp_daily" ADD CONSTRAINT "playmcp_daily_profile_id_playmcp_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."playmcp_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playmcp_profiles" ADD CONSTRAINT "playmcp_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playmcp_yearly" ADD CONSTRAINT "playmcp_yearly_profile_id_playmcp_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."playmcp_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playmcp_analysis_profile_idx" ON "playmcp_analysis" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playmcp_compat_pair_idx" ON "playmcp_compatibility" USING btree ("profile1_id","profile2_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playmcp_daily_profile_date_idx" ON "playmcp_daily" USING btree ("profile_id","for_date_kst");--> statement-breakpoint
CREATE INDEX "playmcp_daily_date_idx" ON "playmcp_daily" USING btree ("for_date_kst");--> statement-breakpoint
CREATE INDEX "playmcp_profiles_user_idx" ON "playmcp_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playmcp_yearly_profile_year_idx" ON "playmcp_yearly" USING btree ("profile_id","year");--> statement-breakpoint
-- 순서 무관 쌍 키: (a,b) 와 (b,a) 가 같은 row 가 되게 application 측 정렬 강제.
ALTER TABLE "playmcp_compatibility"
  ADD CONSTRAINT "playmcp_compat_order_check"
  CHECK (profile1_id < profile2_id);--> statement-breakpoint