import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockMaster } from "@/shared/lib/db/schema";
import { searchStockMaster } from "./server";

const skipIfNoDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

skipIfNoDb("searchStockMaster", () => {
  beforeAll(async () => {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  });

  beforeEach(async () => {
    await db.delete(stockMaster);
    await db.insert(stockMaster).values([
      {
        symbol: "005930.KS",
        krxCode: "005930",
        koreanName: "삼성전자",
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
      {
        symbol: "005935.KS",
        krxCode: "005935",
        koreanName: "삼성전자우",
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
      {
        symbol: "036930.KQ",
        krxCode: "036930",
        koreanName: "주성엔지니어링",
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      },
      {
        symbol: "000000.KQ",
        krxCode: "000000",
        koreanName: "상장폐지테스트",
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
        delisted: true,
      },
    ]);
  });

  it("한글 substring 매칭", async () => {
    const r = await searchStockMaster("주성");
    expect(r).toHaveLength(1);
    expect(r[0].symbol).toBe("036930.KQ");
  });

  it("한글 substring — 다건 (삼성)", async () => {
    const r = await searchStockMaster("삼성");
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.some((x) => x.symbol === "005930.KS")).toBe(true);
    expect(r.some((x) => x.symbol === "005935.KS")).toBe(true);
  });

  it("6자리 코드 정확 매칭", async () => {
    const r = await searchStockMaster("036930");
    expect(r).toHaveLength(1);
    expect(r[0].displayName).toBe("주성엔지니어링");
  });

  it("delisted=true 는 제외", async () => {
    const r = await searchStockMaster("상장폐지");
    expect(r).toEqual([]);
  });

  it("빈 쿼리 → 빈 결과", async () => {
    expect(await searchStockMaster("")).toEqual([]);
    expect(await searchStockMaster("   ")).toEqual([]);
  });
});
