ALTER TABLE "email_threads" ADD COLUMN "has_list_unsubscribe" boolean;--> statement-breakpoint
ALTER TABLE "email_threads" ADD COLUMN "has_list_id" boolean;--> statement-breakpoint
ALTER TABLE "email_threads" ADD COLUMN "precedence" text;