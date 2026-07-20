CREATE TABLE "github_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"is_draft" boolean DEFAULT false NOT NULL,
	"head_sha" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_sync_state" (
	"source" text PRIMARY KEY NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"total_count" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"build_state" text,
	"main_head_sha" text,
	"main_head_committed_at" timestamp with time zone,
	"build_run_url" text,
	"build_conclusion" text
);
--> statement-breakpoint
CREATE TABLE "github_workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_name" text NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"head_sha" text NOT NULL,
	"head_branch" text,
	"event" text,
	"run_number" integer NOT NULL,
	"run_attempt" integer DEFAULT 1 NOT NULL,
	"url" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_issues_repo_updated_idx" ON "github_issues" USING btree ("repo","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "github_pull_requests_repo_created_idx" ON "github_pull_requests" USING btree ("repo","created_at");--> statement-breakpoint
CREATE INDEX "github_workflow_runs_repo_started_idx" ON "github_workflow_runs" USING btree ("repo","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "github_workflow_runs_head_sha_idx" ON "github_workflow_runs" USING btree ("head_sha");