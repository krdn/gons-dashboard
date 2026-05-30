CREATE TABLE "stock_timeframe_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"depth" text NOT NULL,
	"as_of" timestamp NOT NULL,
	"result" jsonb NOT NULL,
	"cost_usd" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_timeframe_analyses" ADD CONSTRAINT "stock_timeframe_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;