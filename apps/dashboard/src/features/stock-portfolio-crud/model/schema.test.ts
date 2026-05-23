import { describe, expect, it } from "vitest";
import { AddHoldingSchema } from "./schema";

describe("AddHoldingSchema", () => {
  const base = {
    symbol: "AAPL",
    assetClass: "stock" as const,
    market: "NASDAQ" as const,
    displayName: "Apple",
  };

  it("holding: quantity 와 avgCost 필수", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "holding",
      quantity: "10",
      avgCost: "150",
    });
    expect(result.success).toBe(true);
  });

  it("holding: quantity 비어있으면 reject", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "holding",
      avgCost: "150",
    });
    expect(result.success).toBe(false);
  });

  it("watchlist: quantity/avgCost 없어도 통과", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "watchlist",
    });
    expect(result.success).toBe(true);
  });

  it("watchlist: quantity 가 와도 통과 (선택 입력)", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "watchlist",
      quantity: "5",
    });
    expect(result.success).toBe(true);
  });

  it("kind 미지정 시 holding 으로 default", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      quantity: "10",
      avgCost: "150",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("holding");
  });
});
