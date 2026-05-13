/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks need permissive typing */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateYearlyReading } from "./generateYearlyReading";

vi.mock("../lib/llm-client", () => ({ callSajuLlm: vi.fn() }));
vi.mock("../lib/budget", () => ({
  assertSajuBudgetOk: vi.fn().mockResolvedValue(undefined),
  logSajuSpend: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class extends Error {},
}));
vi.mock("@/shared/lib/db/client", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));
vi.mock("@/shared/config/env", () => ({
  env: {
    SAJU_LLM_MODEL: "claude-opus-4-7",
    SAJU_LLM_DAILY_BUDGET_KRW: 1000,
    SAJU_LLM_TEMPERATURE: 0.3,
  },
}));

const FAKE_CHART = {
  pillars: {
    year: { stem: "丁", branch: "未" },
    month: { stem: "癸", branch: "卯" },
    day: { stem: "壬", branch: "辰" },
    hour: { stem: "癸", branch: "卯" },
  },
  elements: { wood: 2, fire: 1, earth: 2, metal: 0, water: 3 },
  strength: "strong" as const,
  tenGods: {} as never,
  pattern: "傷官格",
  yongSin: ["fire", "earth"],
  giSin: ["earth", "water"],
  majorFortunes: [],
  inputHash: "h1",
};

describe("generateYearlyReading", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cache hit (model 일치) → LLM 안 부름", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { body: "cached body", model: "claude-opus-4-7" },
            ]),
        }),
      }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");

    const result = await generateYearlyReading({
      chart: FAKE_CHART as any,
      chartId: "c1",
      year: 2026,
    });

    expect(result).toEqual({ body: "cached body", cached: true });
    expect(callSajuLlm).not.toHaveBeenCalled();
  });

  it("cache miss → LLM 호출 + UPSERT", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: "**올해 전체 흐름** ...",
      inputTokens: 2500,
      outputTokens: 1500,
      krw: 200,
      model: "claude-opus-4-7",
    });

    const result = await generateYearlyReading({
      chart: FAKE_CHART as any,
      chartId: "c1",
      year: 2026,
    });

    expect(result).toEqual({ body: "**올해 전체 흐름** ...", cached: false });
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
  });

  it("model 변경 → 재생성", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([{ body: "old", model: "claude-sonnet-4-6" }]),
        }),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: "new body",
      inputTokens: 2000,
      outputTokens: 1500,
      krw: 200,
      model: "claude-opus-4-7",
    });

    const result = await generateYearlyReading({
      chart: FAKE_CHART as any,
      chartId: "c1",
      year: 2026,
    });

    expect(result.cached).toBe(false);
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
  });
});
