CREATE TABLE "important_emails" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"importance" text NOT NULL,
	"summary" text NOT NULL,
	"rationale" text NOT NULL,
	"classifier_version" text NOT NULL,
	"classified_by" text NOT NULL,
	"classified_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp,
	"archived_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "important_emails" ADD CONSTRAINT "important_emails_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "important_emails" ADD CONSTRAINT "important_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "important_emails_open_idx" ON "important_emails" USING btree ("user_id","importance","classified_at" DESC NULLS LAST) WHERE "important_emails"."read_at" IS NULL AND "important_emails"."archived_at" IS NULL;