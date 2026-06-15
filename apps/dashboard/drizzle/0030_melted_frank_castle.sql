CREATE TABLE "email_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"reply_needed_limit" integer DEFAULT 5 NOT NULL,
	"important_limit" integer DEFAULT 10 NOT NULL,
	"window_days" integer DEFAULT 7 NOT NULL,
	"reply_severity_threshold" text DEFAULT 'med' NOT NULL,
	"important_threshold" text DEFAULT 'med' NOT NULL,
	"categories" jsonb DEFAULT '["money","security","schedule","notice"]'::jsonb NOT NULL,
	"llm_reply_enabled" boolean DEFAULT true NOT NULL,
	"llm_important_enabled" boolean DEFAULT true NOT NULL,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"digest_hour_kst" integer DEFAULT 8 NOT NULL,
	"last_digest_sent_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;