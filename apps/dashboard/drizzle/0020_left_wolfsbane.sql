CREATE TABLE "portfolio_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"asset_class" text NOT NULL,
	"market" text NOT NULL,
	"display_name" text NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"avg_cost" numeric(20, 8) NOT NULL,
	"purchased_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_analysis_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"analysis_date" date NOT NULL,
	"user_id" uuid,
	"personas" jsonb NOT NULL,
	"consensus" jsonb NOT NULL,
	"market_snapshot" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_consensus_flips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"from_verdict" text NOT NULL,
	"to_verdict" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_persona_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_analysis_cache" ADD CONSTRAINT "stock_analysis_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_consensus_flips" ADD CONSTRAINT "stock_consensus_flips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_persona_preferences" ADD CONSTRAINT "stock_persona_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_holdings_user_symbol_uq" ON "portfolio_holdings" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "portfolio_holdings_user_idx" ON "portfolio_holdings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_cache_lookup_uq" ON "stock_analysis_cache" USING btree ("symbol","analysis_date","user_id");--> statement-breakpoint
CREATE INDEX "stock_cache_lookup_idx" ON "stock_analysis_cache" USING btree ("user_id","symbol","analysis_date");--> statement-breakpoint
CREATE INDEX "flips_pending_idx" ON "stock_consensus_flips" USING btree ("notified_at") WHERE "stock_consensus_flips"."notified_at" IS NULL;