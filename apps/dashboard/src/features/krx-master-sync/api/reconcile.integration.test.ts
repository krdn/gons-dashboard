import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockMaster,
  stockSymbolMigrations,
  portfolioHoldings,
  stockAnalysisCache,
  users,
} from "@/shared/lib/db/schema";
import { reconcileStockMaster } from "./reconcile";

// CI 와 로컬 DB 미가동 환경에서는 skip. TEST_DATABASE_URL 가 안전 호스트(localhost/127.0.0.1)
// 를 가리켜야 tests/setup.ts hard-block 을 통과 → 실제로 DB 사용 가능.
const skipIfNoDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

skipIfNoDb("reconcileStockMaster — 4분기 처리", () => {
  let userId: string;

  beforeAll(async () => {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  });

  beforeEach(async () => {
    // 테이블 초기화 (FK 순서 주의)
    await db.delete(stockAnalysisCache);
    await db.delete(portfolioHoldings);
    await db.delete(stockSymbolMigrations);
    await db.delete(stockMaster);
    await db.delete(users);
    const [u] = await db
      .insert(users)
      .values({ email: "test@test.com" })
      .returning();
    userId = u.id;
  });

  it("신규 종목 → INSERT", async () => {
    const result = await reconcileStockMaster([
      {
        symbol: "036930.KQ",
        krxCode: "036930",
        koreanName: "주성엔지니어링",
        englishName: null,
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      },
    ]);
    expect(result.upserted).toBe(1);
    expect(result.migrations).toBe(0);
    const rows = await db.select().from(stockMaster);
    expect(rows).toHaveLength(1);
    expect(rows[0].koreanName).toBe("주성엔지니어링");
  });

  it("변경 없음 → lastSyncedAt 만 갱신", async () => {
    await db.insert(stockMaster).values({
      symbol: "005930.KS",
      krxCode: "005930",
      koreanName: "삼성전자",
      marketCategory: "KOSPI",
      securityType: "EQUITY",
    });
    const before = await db
      .select()
      .from(stockMaster)
      .where(eq(stockMaster.symbol, "005930.KS"));
    const beforeTs = before[0].lastSyncedAt.getTime();

    await new Promise((r) => setTimeout(r, 5));

    const result = await reconcileStockMaster([
      {
        symbol: "005930.KS",
        krxCode: "005930",
        koreanName: "삼성전자",
        englishName: null,
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
    ]);
    expect(result.upserted).toBe(1);
    expect(result.migrations).toBe(0);
    const after = await db
      .select()
      .from(stockMaster)
      .where(eq(stockMaster.symbol, "005930.KS"));
    expect(after[0].lastSyncedAt.getTime()).toBeGreaterThan(beforeTs);
  });

  it("이전상장: 066970.KQ → 066970.KS, portfolio UPDATE + cache 삭제 + migration log", async () => {
    await db.insert(stockMaster).values({
      symbol: "066970.KQ",
      krxCode: "066970",
      koreanName: "엘앤에프",
      marketCategory: "KOSDAQ",
      securityType: "EQUITY",
    });
    await db.insert(portfolioHoldings).values({
      userId,
      symbol: "066970.KQ",
      assetClass: "stock",
      market: "KR",
      displayName: "엘앤에프",
      quantity: "10",
      avgCost: "150000",
    });
    await db.insert(stockAnalysisCache).values({
      symbol: "066970.KQ",
      analysisDate: "2026-05-21",
      userId: null,
      personas: {},
      consensus: {},
      marketSnapshot: {},
      promptVersion: "v1",
    });

    const result = await reconcileStockMaster([
      {
        symbol: "066970.KS",
        krxCode: "066970",
        koreanName: "엘앤에프",
        englishName: null,
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
    ]);

    expect(result.migrations).toBe(1);
    const ks = await db
      .select()
      .from(stockMaster)
      .where(eq(stockMaster.symbol, "066970.KS"));
    const kq = await db
      .select()
      .from(stockMaster)
      .where(eq(stockMaster.symbol, "066970.KQ"));
    expect(ks).toHaveLength(1);
    expect(ks[0].delisted).toBe(false);
    expect(kq[0].delisted).toBe(true);

    const holdings = await db.select().from(portfolioHoldings);
    expect(holdings[0].symbol).toBe("066970.KS");

    const cache = await db.select().from(stockAnalysisCache);
    expect(cache).toHaveLength(0);

    const log = await db.select().from(stockSymbolMigrations);
    expect(log[0].fromSymbol).toBe("066970.KQ");
    expect(log[0].toSymbol).toBe("066970.KS");
    expect(log[0].affectedHoldings).toBe(1);
    expect(log[0].invalidatedCacheRows).toBe(1);
  });

  it("상장폐지: 응답에 없던 active row → delisted=true", async () => {
    await db.insert(stockMaster).values([
      {
        symbol: "005930.KS",
        krxCode: "005930",
        koreanName: "삼성전자",
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
      {
        symbol: "999999.KQ",
        krxCode: "999999",
        koreanName: "상장폐지예정",
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      },
    ]);
    const result = await reconcileStockMaster([
      {
        symbol: "005930.KS",
        krxCode: "005930",
        koreanName: "삼성전자",
        englishName: null,
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
    ]);
    expect(result.delisted).toBe(1);
    const delistedRows = await db
      .select()
      .from(stockMaster)
      .where(eq(stockMaster.delisted, true));
    expect(delistedRows[0].symbol).toBe("999999.KQ");
  });
});
