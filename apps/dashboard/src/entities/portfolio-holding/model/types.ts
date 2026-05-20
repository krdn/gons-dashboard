// portfolio-holding entity — 환경 중립 타입.
// AssetClass/Market 은 stock entity 의 client 진입점에서 import (server-only 비전염).

import type { AssetClass, Market } from "@/entities/stock/client";

export interface PortfolioHolding {
  id: string;
  userId: string;
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  // numeric(20,8) 정밀도 → string 으로 보존 (JS number 부정확성 회피)
  quantity: string;
  avgCost: string;
  // date 컬럼: Drizzle 추론이 string|null
  purchasedAt: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface NewPortfolioHolding {
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  quantity: string;
  avgCost: string;
  purchasedAt?: string | null;
}
