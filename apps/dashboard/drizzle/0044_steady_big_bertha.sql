CREATE TABLE "memo_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"label_ko" text NOT NULL,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memo_categories_slug_format" CHECK ("memo_categories"."id" ~ '^[a-z][a-z0-9-]*$' AND length("memo_categories"."id") BETWEEN 1 AND 40),
	CONSTRAINT "memo_categories_label_len" CHECK (length("memo_categories"."label_ko") BETWEEN 1 AND 20)
);
--> statement-breakpoint
INSERT INTO "memo_categories" ("id", "label_ko", "is_seed") VALUES
  ('idea', '아이디어', true),
  ('todo', '할 일', true),
  ('journal', '일기', true),
  ('reference', '참고', true),
  ('draft', '초안', true),
  ('etc', '기타', true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "memos" DROP CONSTRAINT "memos_category_check";--> statement-breakpoint
ALTER TABLE "memos" ADD CONSTRAINT "memos_category_memo_categories_id_fk" FOREIGN KEY ("category") REFERENCES "public"."memo_categories"("id") ON DELETE set null ON UPDATE no action;