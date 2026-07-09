CREATE TABLE "memo_transform_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"instruction" text NOT NULL,
	"fidelity_guard" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memo_transform_presets_slug_format" CHECK ("memo_transform_presets"."slug" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "memo_transform_presets_label_len" CHECK (length("memo_transform_presets"."label") BETWEEN 1 AND 20),
	CONSTRAINT "memo_transform_presets_instruction_len" CHECK (length("memo_transform_presets"."instruction") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "memo_transformations" DROP CONSTRAINT "memo_transformations_preset_check";--> statement-breakpoint
ALTER TABLE "memo_transformations" ADD COLUMN "preset_label" text;--> statement-breakpoint
ALTER TABLE "memo_transform_presets" ADD CONSTRAINT "memo_transform_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memo_transform_presets_user_slug_uq" ON "memo_transform_presets" USING btree ("user_id","slug");