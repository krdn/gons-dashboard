// detectConsensusFlip 통합 테스트.
// stock_analysis_cache 에 어제/오늘 row 를 직접 INSERT 한 뒤 4 케이스 검증:
// 1. flip 감지 (verdict 다름 + prompt_version 같음)
// 2. prompt_version 다르면 null
// 3. 같은 verdict 면 null
// 4. 어제 row 없으면 null (신규 종목)
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockAnalysisCache,
  stockConsensusFlips,
  pushSubscriptions,
  portfolioHoldings,
  users,
} from "@/shared/lib/db/schema";
import { detectConsensusFlip } from "@/features/stock-push-flip/api/detect";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000999";
const TEST_SYMBOL = "FLIP-TEST";

describe("detectConsensusFlip", () => {
  beforeEach(async () => {
    await db.delete(stockConsensusFlips);
    await db.delete(pushSubscriptions);
    await db.delete(portfolioHoldings);
    await db
      .delete(stockAnalysisCache)
      .where(eq(stockAnalysisCache.symbol, TEST_SYMBOL));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    await db.insert(users).values({
      id: TEST_USER_ID,
      name: "test",
      email: "flip-test@example.com",
    });
  });

  afterEach(async () => {
    await db
      .delete(stockAnalysisCache)
      .where(eq(stockAnalysisCache.symbol, TEST_SYMBOL));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("어제와 오늘 verdict 가 다르고 prompt_version 같으면 flip 반환", async () => {
    await db.insert(stockAnalysisCache).values([
      {
        symbol: TEST_SYMBOL,
        analysisDate: "2026-05-20",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
      {
        symbol: TEST_SYMBOL,
        analysisDate: "2026-05-21",
        userId: null,
        personas: {},
        consensus: { verdict: "HOLD" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
    ]);

    const result = await detectConsensusFlip({
      symbol: TEST_SYMBOL,
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });

    expect(result).toEqual({
      symbol: TEST_SYMBOL,
      fromVerdict: "BUY",
      toVerdict: "HOLD",
    });
  });

  it("prompt_version 다르면 null", async () => {
    await db.insert(stockAnalysisCache).values([
      {
        symbol: TEST_SYMBOL,
        analysisDate: "2026-05-20",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
      {
        symbol: TEST_SYMBOL,
        analysisDate: "2026-05-21",
        userId: null,
        personas: {},
        consensus: { verdict: "HOLD" } as never,
        marketSnapshot: {},
        promptVersion: "2",
      },
    ]);

    const result = await detectConsensusFlip({
      symbol: TEST_SYMBOL,
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });
    expect(result).toBeNull();
  });

  it("같은 verdict 면 null", async () => {
    await db.insert(stockAnalysisCache).values([
      {
        symbol: TEST_SYMBOL,
        analysisDate: "2026-05-20",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
      {
        symbol: TEST_SYMBOL,
        analysisDate: "2026-05-21",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
    ]);

    const result = await detectConsensusFlip({
      symbol: TEST_SYMBOL,
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });
    expect(result).toBeNull();
  });

  it("어제 row 가 없으면 null (신규 종목)", async () => {
    await db.insert(stockAnalysisCache).values({
      symbol: TEST_SYMBOL,
      analysisDate: "2026-05-21",
      userId: null,
      personas: {},
      consensus: { verdict: "BUY" } as never,
      marketSnapshot: {},
      promptVersion: "1",
    });

    const result = await detectConsensusFlip({
      symbol: TEST_SYMBOL,
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });
    expect(result).toBeNull();
  });
});
