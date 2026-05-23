ALTER TABLE "portfolio_holdings" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ALTER COLUMN "avg_cost" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD COLUMN "kind" text DEFAULT 'holding' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD COLUMN "push_opt_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_kind_check" CHECK ("portfolio_holdings"."kind" IN ('holding', 'watchlist'));--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_holding_qty_check" CHECK (("portfolio_holdings"."kind" = 'watchlist') OR ("portfolio_holdings"."quantity" IS NOT NULL AND "portfolio_holdings"."avg_cost" IS NOT NULL));