export type AssetClass = "stock" | "crypto" | "commodity";
export type Market = "NASDAQ" | "NYSE" | "KRX" | "CRYPTO" | "COMMODITY";

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
