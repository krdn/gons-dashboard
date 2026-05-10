DROP INDEX "audit_logs_recent_idx";--> statement-breakpoint
DROP INDEX "audit_logs_container_idx";--> statement-breakpoint
CREATE INDEX "audit_logs_host_recent_idx" ON "audit_logs" USING btree ("host_id","created_at" DESC NULLS LAST);