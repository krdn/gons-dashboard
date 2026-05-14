/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks need permissive typing for fluent Drizzle chains */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateReading } from "./generateReading";

vi.mock("../lib/llm-client", () => ({ callSajuLlm: vi.fn() }));
vi.mock("../lib/budget", () => ({
  assertSajuBudgetOk: vi.fn().mockResolvedValue(undefined),
  logSajuSpend: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class extends Error {},
}));
vi.mock("@/shared/lib/db/client", () => ({ db: { select: vi.fn(), insert: vi.fn() } }));
vi.mock("@/shared/config/env", () => ({
  env: {
    SAJU_LLM_MODEL: "claude-opus-4-7",
    SAJU_LLM_DAILY_BUDGET_KRW: 1000,
    SAJU_LLM_TEMPERATURE: 0.3,
  },
}));

const FAKE_CHART_ID = "00000000-0000-0000-0000-000000000001";
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
  yongSin: ["fire", "earth"] as const,
  giSin: ["earth", "water"] as const,
  majorFortunes: [],
  inputHash: "test-hash",
};

describe("generateReading", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cache hit (model 일치) — LLM 호출 안 함", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ body: "cached body", model: "claude-opus-4-7", promptVersion: "section-v1" }]),
        }),
      }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");

    const result = await generateReading({
      chartId: FAKE_CHART_ID,
      chart: FAKE_CHART as any,
      section: "overview",
    });

    expect(result).toEqual({ body: "cached body", cached: true });
    expect(callSajuLlm).not.toHaveBeenCalled();
  });

  it("cache miss — LLM 호출 + UPSERT + spend log", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: "generated",
      inputTokens: 100,
      outputTokens: 200,
      krw: 30,
      model: "claude-opus-4-7",
    });
    const { logSajuSpend } = await import("../lib/budget");

    const result = await generateReading({
      chartId: FAKE_CHART_ID,
      chart: FAKE_CHART as any,
      section: "overview",
    });

    expect(result).toEqual({ body: "generated", cached: false });
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
    expect(logSajuSpend).toHaveBeenCalledWith(expect.objectContaining({ krw: 30 }));
  });

  it("model 변경 — 캐시 무시하고 재생성", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ body: "old body", model: "claude-sonnet-4-6", promptVersion: "section-v1" }]),
        }),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: "new body",
      inputTokens: 100,
      outputTokens: 200,
      krw: 30,
      model: "claude-opus-4-7",
    });

    const result = await generateReading({
      chartId: FAKE_CHART_ID,
      chart: FAKE_CHART as any,
      section: "overview",
    });

    expect(result).toEqual({ body: "new body", cached: false });
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
  });
});
