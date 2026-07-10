CREATE TABLE "memo_transform_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_model" text DEFAULT 'claude' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memo_transform_settings_default_model_check" CHECK ("memo_transform_settings"."default_model" IN ('claude', 'codex', 'gemini'))
);
--> statement-breakpoint
ALTER TABLE "memo_transform_presets" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "memo_transform_settings" ADD CONSTRAINT "memo_transform_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_transform_presets" ADD CONSTRAINT "memo_transform_presets_model_check" CHECK ("memo_transform_presets"."model" IS NULL OR "memo_transform_presets"."model" IN ('claude', 'codex', 'gemini'));