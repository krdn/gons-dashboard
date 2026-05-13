/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks need permissive typing */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateDailyFortune } from "./generateDailyFortune";

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

const FAKE_CHART_ROW = {
  id: "chart-1",
  profileId: "p-1",
  inputHash: "h1",
  yearStem: "丁",
  yearBranch: "未",
  monthStem: "癸",
  monthBranch: "卯",
  dayStem: "壬",
  dayBranch: "辰",
  hourStem: "癸",
  hourBranch: "卯",
  elements: { wood: 2, fire: 1, earth: 2, metal: 0, water: 3 },
  strength: "strong",
  tenGods: {
    yearStem: "正財",
    yearBranch: "正官",
    monthStem: "劫財",
    monthBranch: "傷官",
    dayBranch: "偏官",
    hourStem: "劫財",
    hourBranch: "傷官",
  },
  pattern: "傷官格",
  yongSin: ["fire", "earth"],
  giSin: ["earth", "water"],
  majorFortunes: [],
  createdAt: new Date(),
};

const VALID_PAYLOAD = {
  summary: "戊子 일진 — 편관·겁재가 동시...",
  dayPillar: "戊子",
  forDate: "2026-05-14",
  overallScore: 4,
  scores: [
    { label: "재물", score: 3, note: "..." },
    { label: "일", score: 4, note: "..." },
    { label: "관계", score: 3, note: "..." },
    { label: "건강", score: 4, note: "..." },
    { label: "학습", score: 4, note: "..." },
  ],
  hourly: Array.from({ length: 8 }, (_, i) => ({
    range: `${String(5 + i * 2).padStart(2, "0")}–${String(7 + i * 2).padStart(2, "0")}`,
    vibe: "...",
  })),
  recommendations: ["..."],
  cautions: ["..."],
  remedy: { colors: ["청색"], directions: ["북"], foods: ["..."], items: ["..."] },
  closing: "...",
};

describe("generateDailyFortune", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cache hit (model 일치) — LLM 호출 안 함", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                model: "claude-opus-4-7",
                payload: VALID_PAYLOAD,
                dayStem: "戊",
                dayBranch: "子",
              },
            ]),
        }),
      }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");

    const result = await generateDailyFortune({
      chartRow: FAKE_CHART_ROW as any,
      forDate: "2026-05-14",
    });

    expect(result.cached).toBe(true);
    expect(callSajuLlm).not.toHaveBeenCalled();
  });

  it("cache miss — LLM 호출 + Zod 통과 + UPSERT", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: JSON.stringify(VALID_PAYLOAD),
      inputTokens: 1000,
      outputTokens: 500,
      krw: 100,
      model: "claude-opus-4-7",
    });
    const { logSajuSpend } = await import("../lib/budget");

    const result = await generateDailyFortune({
      chartRow: FAKE_CHART_ROW as any,
      forDate: "2026-05-14",
    });

    expect(result.cached).toBe(false);
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
    expect(logSajuSpend).toHaveBeenCalled();
  });

  it("Zod 검증 실패 → 1회 재시도 성공", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any)
      .mockResolvedValueOnce({
        body: '{"summary": "incomplete"}',
        inputTokens: 100,
        outputTokens: 50,
        krw: 10,
        model: "claude-opus-4-7",
      })
      .mockResolvedValueOnce({
        body: JSON.stringify(VALID_PAYLOAD),
        inputTokens: 1000,
        outputTokens: 500,
        krw: 100,
        model: "claude-opus-4-7",
      });

    const result = await generateDailyFortune({
      chartRow: FAKE_CHART_ROW as any,
      forDate: "2026-05-14",
    });

    expect(result.cached).toBe(false);
    expect(callSajuLlm).toHaveBeenCalledTimes(2);
  });

  it("Zod 실패 + 재시도도 실패 → throw", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: '{"oops": "still bad"}',
      inputTokens: 100,
      outputTokens: 50,
      krw: 10,
      model: "claude-opus-4-7",
    });

    await expect(
      generateDailyFortune({ chartRow: FAKE_CHART_ROW as any, forDate: "2026-05-14" }),
    ).rejects.toThrow();
  });
});
