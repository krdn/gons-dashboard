CREATE TABLE "memo_transformations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memo_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"model" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memo_transformations_preset_check" CHECK ("memo_transformations"."preset" IN ('tidy', 'polish', 'summary', 'structured', 'todos', 'journal', 'email')),
	CONSTRAINT "memo_transformations_content_not_empty" CHECK (length("memo_transformations"."content") > 0)
);
--> statement-breakpoint
ALTER TABLE "memo_transformations" ADD CONSTRAINT "memo_transformations_memo_id_memos_id_fk" FOREIGN KEY ("memo_id") REFERENCES "public"."memos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memo_transformations_memo_preset_uq" ON "memo_transformations" USING btree ("memo_id","preset");