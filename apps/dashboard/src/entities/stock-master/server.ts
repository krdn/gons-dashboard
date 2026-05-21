// 한글/6자리코드 KRX 종목 검색.
// 한글: ILIKE substring + pg_trgm GIN 인덱스 (<5ms @ 4,000 row)
// 코드: 6자리 정확 매칭 + krx_code btree 인덱스
// delisted=true 는 항상 제외.
import "server-only";
import { and, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockMaster } from "@/shared/lib/db/schema";
import type { NormalizedSearchResult } from "@gons/stock-analysis";

const LIMIT = 10;

export async function searchStockMaster(
  query: string,
): Promise<NormalizedSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const isKrxCode = /^\d{6}$/.test(trimmed);
  const condition = isKrxCode
    ? eq(stockMaster.krxCode, trimmed)
    : ilike(stockMaster.koreanName, `%${trimmed}%`);

  const rows = await db
    .select()
    .from(stockMaster)
    .where(and(eq(stockMaster.delisted, false), condition))
    .orderBy(sql`length(${stockMaster.koreanName})`, stockMaster.koreanName)
    .limit(LIMIT);

  return rows.map((r) => ({
    symbol: r.symbol,
    displayName: r.koreanName,
    assetClass: "stock",
    market: "KRX",
    exchange: r.marketCategory === "KOSPI" ? "KSE" : "KOSDAQ",
  }));
}
