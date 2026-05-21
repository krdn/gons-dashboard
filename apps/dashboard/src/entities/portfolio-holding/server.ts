// portfolio-holding entity — server-only 진입점.
// "use client" 트리에서 import 절대 금지 (Drizzle 의존 + DB 연결 보유).

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import type { PortfolioHolding, NewPortfolioHolding } from "./model/types";

export type { PortfolioHolding, NewPortfolioHolding };

// 단일 사용자 보유 종목 조회 (v1 — 정렬 미적용; 위젯에서 필요 시 ORDER BY 추가).
export async function getHoldings(userId: string): Promise<PortfolioHolding[]> {
  const rows = await db
    .select()
    .from(portfolioHoldings)
    .where(eq(portfolioHoldings.userId, userId));

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    symbol: r.symbol,
    assetClass: r.assetClass as PortfolioHolding["assetClass"],
    market: r.market as PortfolioHolding["market"],
    displayName: r.displayName,
    quantity: r.quantity,
    avgCost: r.avgCost,
    purchasedAt: r.purchasedAt,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
