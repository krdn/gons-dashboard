export type AssetClass = "stock" | "crypto" | "commodity";
export type Market = "NASDAQ" | "NYSE" | "KRX" | "CRYPTO" | "COMMODITY";

export interface NormalizedQuote {
  symbol: string;
  price: number;
  changePct: number;
  currency: string;
  fetchedAt: string; // ISO 8601
}

export interface NormalizedSearchResult {
  symbol: string;
  displayName: string;
  assetClass: AssetClass;
  market: Market;
  exchange: string;
}

export interface NormalizedFundamentals {
  symbol: string;
  marketCap?: number;
  per?: number;
  pbr?: number;
  dividendYield?: number;
  ma50?: number;
  ma200?: number;
}
