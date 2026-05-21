import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockMaster,
  stockSymbolMigrations,
  portfolioHoldings,
  stockAnalysisCache,
} from "@/shared/lib/db/schema";

export interface ReconcileInput {
  symbol: string; // "036930.KQ"
  krxCode: string;
  koreanName: string;
  englishName: string | null;
  marketCategory: "KOSPI" | "KOSDAQ";
  securityType: "EQUITY" | "ETF" | "ETN" | "REIT" | "SPAC";
}

export interface ReconcileResult {
  upserted: number;
  delisted: number;
  migrations: number;
  errors: string[];
}

export async function reconcileStockMaster(
  rows: ReconcileInput[],
): Promise<ReconcileResult> {
  const errors: string[] = [];
  let upserted = 0;
  let migrations = 0;

  for (const row of rows) {
    try {
      const [existing] = await db
        .select()
        .from(stockMaster)
        .where(
          and(
            eq(stockMaster.krxCode, row.krxCode),
            eq(stockMaster.delisted, false),
          ),
        )
        .limit(1);

      if (!existing) {
        // 신규 상장
        await db.insert(stockMaster).values({
          symbol: row.symbol,
          krxCode: row.krxCode,
          koreanName: row.koreanName,
          englishName: row.englishName,
          marketCategory: row.marketCategory,
          securityType: row.securityType,
        });
        upserted++;
        continue;
      }

      if (existing.symbol === row.symbol) {
        // 변경 없음 — 메타 + lastSyncedAt 갱신
        await db
          .update(stockMaster)
          .set({
            koreanName: row.koreanName,
            englishName: row.englishName,
            marketCategory: row.marketCategory,
            securityType: row.securityType,
            lastSyncedAt: new Date(),
          })
          .where(eq(stockMaster.symbol, row.symbol));
        upserted++;
        continue;
      }

      // 이전상장 감지 (.KQ → .KS 등)
      await db.transaction(async (tx) => {
        await tx.insert(stockMaster).values({
          symbol: row.symbol,
          krxCode: row.krxCode,
          koreanName: row.koreanName,
          englishName: row.englishName,
          marketCategory: row.marketCategory,
          securityType: row.securityType,
        });
        const updated = await tx
          .update(portfolioHoldings)
          .set({ symbol: row.symbol, updatedAt: new Date() })
          .where(eq(portfolioHoldings.symbol, existing.symbol))
          .returning();
        const invalidated = await tx
          .delete(stockAnalysisCache)
          .where(eq(stockAnalysisCache.symbol, existing.symbol))
          .returning();
        await tx.insert(stockSymbolMigrations).values({
          krxCode: row.krxCode,
          fromSymbol: existing.symbol,
          toSymbol: row.symbol,
          affectedHoldings: updated.length,
          invalidatedCacheRows: invalidated.length,
        });
        await tx
          .update(stockMaster)
          .set({ delisted: true })
          .where(eq(stockMaster.symbol, existing.symbol));
      });
      upserted++;
      migrations++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${row.symbol}: ${msg}`);
    }
  }

  // 응답에 없던 active row → delisted=true (상장폐지)
  const fetchedKrxCodes = rows.map((r) => r.krxCode);
  let delisted = 0;
  if (fetchedKrxCodes.length > 0) {
    const result = await db
      .update(stockMaster)
      .set({ delisted: true })
      .where(
        and(
          eq(stockMaster.delisted, false),
          notInArray(stockMaster.krxCode, fetchedKrxCodes),
        ),
      )
      .returning();
    delisted = result.length;
  }

  return { upserted, delisted, migrations, errors };
}
