CREATE TABLE "memo_action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp,
	"all_day" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reminded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memo_action_items_kind_check" CHECK ("memo_action_items"."kind" IN ('todo', 'event')),
	CONSTRAINT "memo_action_items_status_check" CHECK ("memo_action_items"."status" IN ('proposed', 'accepted', 'dismissed', 'done')),
	CONSTRAINT "memo_action_items_title_len" CHECK (length("memo_action_items"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "memos" ADD COLUMN "actions_extracted_at" timestamp;--> statement-breakpoint
ALTER TABLE "memo_action_items" ADD CONSTRAINT "memo_action_items_memo_id_memos_id_fk" FOREIGN KEY ("memo_id") REFERENCES "public"."memos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_action_items" ADD CONSTRAINT "memo_action_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memo_action_items_user_status_idx" ON "memo_action_items" USING btree ("user_id","status");