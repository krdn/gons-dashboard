CREATE TABLE "fortune_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_hanja" text,
	"relation" text NOT NULL,
	"birth_date" text NOT NULL,
	"calendar" text DEFAULT 'solar' NOT NULL,
	"gender" text NOT NULL,
	"birth_time" text,
	"birth_city" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fortune_profiles" ADD CONSTRAINT "fortune_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fortune_profiles_user_idx" ON "fortune_profiles" USING btree ("user_id");