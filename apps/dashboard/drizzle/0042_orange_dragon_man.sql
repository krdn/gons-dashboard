CREATE TABLE "memo_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_end" date NOT NULL,
	"summary" text NOT NULL,
	"memo_count" integer NOT NULL,
	"resurfaced_memo_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memo_digests" ADD CONSTRAINT "memo_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memo_digests_user_week_uq" ON "memo_digests" USING btree ("user_id","week_end");