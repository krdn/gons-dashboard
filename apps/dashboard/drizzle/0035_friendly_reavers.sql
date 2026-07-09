CREATE TABLE "memos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"raw_content" text NOT NULL,
	"cleaned_content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memos_source_check" CHECK ("memos"."source" IN ('voice', 'text')),
	CONSTRAINT "memos_raw_not_empty" CHECK (length("memos"."raw_content") > 0),
	CONSTRAINT "memos_cleaned_not_empty" CHECK (length("memos"."cleaned_content") > 0)
);
--> statement-breakpoint
ALTER TABLE "memos" ADD CONSTRAINT "memos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memos_user_created_idx" ON "memos" USING btree ("user_id","created_at" DESC NULLS LAST);