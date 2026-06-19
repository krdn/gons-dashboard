import type { AssetClass, Market } from "@/shared/lib/stock/types";

type PortfolioHoldingKind = "holding" | "watchlist";

export interface PortfolioHolding {
  id: string;
  userId: string;
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  kind: PortfolioHoldingKind;
  // watchlist 면 null. numeric(20,8) → string 보존.
  quantity: string | null;
  avgCost: string | null;
  purchasedAt: string | null;
  pushOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewPortfolioHolding {
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  kind: PortfolioHoldingKind;
  quantity?: string | null;
  avgCost?: string | null;
  purchasedAt?: string | null;
  pushOptIn?: boolean;
}
