// portfolio-holding entity — 환경 중립 타입.
// AssetClass/Market 은 cross-cutting 타입이라 shared 에 둠 (FSD entities 간 직접
// 참조 금지 룰 준수).

import type { AssetClass, Market } from "@/shared/lib/stock/types";

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
