ALTER TABLE "portfolio_holdings"
	ADD CONSTRAINT "portfolio_holdings_quantity_positive" CHECK (quantity > 0),
	ADD CONSTRAINT "portfolio_holdings_avg_cost_nonnegative" CHECK (avg_cost >= 0);
