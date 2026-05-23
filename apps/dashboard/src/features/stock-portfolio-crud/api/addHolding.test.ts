import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/shared/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const insertSpy = { values: undefined as unknown };
const insertReturning = vi.fn().mockResolvedValue([{ id: "h-1" }]);
const selectCount = vi.fn().mockResolvedValue([{ count: 0 }]);

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        insertSpy.values = v;
        return { returning: () => insertReturning() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => selectCount(),
      }),
    }),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/shared/config/env", () => ({
  env: { STOCK_WATCHLIST_MAX_PER_USER: 2 },
}));

import { addHolding } from "./addHolding";

beforeEach(() => {
  insertSpy.values = undefined;
  insertReturning.mockClear();
  selectCount.mockClear();
  selectCount.mockResolvedValue([{ count: 0 }]);
});

describe("addHolding", () => {
  const base = {
    symbol: "AAPL",
    assetClass: "stock" as const,
    market: "NASDAQ" as const,
    displayName: "Apple",
  };

  it("holding: quantity/avgCost insert 그대로 + pushOptIn=true default", async () => {
    const res = await addHolding({
      ...base,
      kind: "holding",
      quantity: "10",
      avgCost: "150",
    });
    expect(res.success).toBe(true);
    expect(insertSpy.values).toMatchObject({
      kind: "holding",
      quantity: "10",
      avgCost: "150",
      pushOptIn: true,
    });
  });

  it("watchlist: quantity/avgCost null insert + pushOptIn=false default", async () => {
    const res = await addHolding({
      ...base,
      kind: "watchlist",
    });
    expect(res.success).toBe(true);
    expect(insertSpy.values).toMatchObject({
      kind: "watchlist",
      quantity: null,
      avgCost: null,
      pushOptIn: false,
    });
  });

  it("watchlist: 캡 초과 시 reject", async () => {
    selectCount.mockResolvedValueOnce([{ count: 2 }]);
    const res = await addHolding({ ...base, kind: "watchlist" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/관심종목.*최대/);
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("watchlist: 명시적 pushOptIn=true override 가능", async () => {
    const res = await addHolding({
      ...base,
      kind: "watchlist",
      pushOptIn: true,
    });
    expect(res.success).toBe(true);
    expect(insertSpy.values).toMatchObject({
      kind: "watchlist",
      pushOptIn: true,
    });
  });
});
