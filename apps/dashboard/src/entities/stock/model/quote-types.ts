import type { AssetClass, Market } from "@/shared/lib/stock/types";

export type { AssetClass, Market };

export interface Quote {
  symbol: string;
  price: number;
  changePct: number;
  currency: string;
  fetchedAt: string; // ISO 8601
}

export interface SearchResult {
  symbol: string;
  displayName: string;
  assetClass: AssetClass;
  market: Market;
  exchange: string;
}
