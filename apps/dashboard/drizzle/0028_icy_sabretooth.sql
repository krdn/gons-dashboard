CREATE TABLE "autopilot_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"deploy_flag" text,
	"candidate_count" integer NOT NULL,
	"selected_title" text,
	"selected_score" real,
	"selected_change_type" text,
	"selected_owner" text,
	"pr_url" text,
	"merged" boolean DEFAULT false NOT NULL,
	"needs_human" boolean DEFAULT false NOT NULL,
	"reason" text,
	"backlog_top3" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"debate" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
