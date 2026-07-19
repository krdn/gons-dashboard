ALTER TABLE "memos" DROP CONSTRAINT "memos_source_check";--> statement-breakpoint
ALTER TABLE "memos" ADD CONSTRAINT "memos_source_check" CHECK ("memos"."source" IN ('voice', 'text', 'agent'));