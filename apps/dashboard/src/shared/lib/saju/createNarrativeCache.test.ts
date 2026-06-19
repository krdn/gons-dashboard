import { describe, it, expect, vi, beforeEach } from "vitest";
import { z, ZodError } from "zod";

// gateway / budget / env 를 mock. mock 은 실제 계약을 지킨다:
//  - analyzeStructured 는 { object, usage } 반환
//  - normalizeUsage 는 항상 { inputTokens, outputTokens } 반환 (undefined 아님 — 계약)
const analyzeStructured = vi.fn();
const normalizeUsage = vi.fn((u: { input?: number; output?: number } | undefined) => ({
  inputTokens: u?.input ?? 0,
  outputTokens: u?.output ?? 0,
}));
vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: (...a: unknown[]) => analyzeStructured(...a),
  normalizeUsage: (u: { input?: number; output?: number } | undefined) => normalizeUsage(u),
}));

const assertSajuBudgetOk = vi.fn().mockResolvedValue(undefined);
const logSajuSpend = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/saju-reading/lib/budget", () => ({
  assertSajuBudgetOk: (...a: unknown[]) => assertSajuBudgetOk(...a),
  logSajuSpend: (...a: unknown[]) => logSajuSpend(...a),
}));

vi.mock("@/shared/lib/llm/anthropic", () => ({
  gatewayDefaults: { provider: "claude-cli", baseUrl: "x", apiKey: "x" },
}));
vi.mock("@/shared/config/env", () => ({ env: { SAJU_LLM_DAILY_BUDGET_KRW: 20000 } }));

import { createNarrativeCache, type NarrativeSchool } from "./createNarrativeCache";

// 테스트용 최소 sections 스키마.
const sectionsSchema = z.object({ personality: z.string() });
const outputSchema = z.object({
  narrativeText: z.string(),
  sections: sectionsSchema,
  schoolSpecific: z.object({ note: z.string() }),
  citations: z.array(z.string()),
});
const SCHEMA: Record<NarrativeSchool, typeof outputSchema> = {
  ko: outputSchema,
  "cn-ziping": outputSchema,
  "cn-mangpai": outputSchema,
  jp: outputSchema,
};

const VALID_OUTPUT = {
  narrativeText: "본문",
  sections: { personality: "성격" },
  schoolSpecific: { note: "학파" },
  citations: ["출처1"],
};

function makeConfig(overrides: Partial<Parameters<typeof createNarrativeCache>[0]> = {}) {
  // override 가 있으면 그걸 쓰고, 없으면 기본 mock 생성 — destructure 로 반환하는
  // 인스턴스와 config 에 실린 인스턴스가 동일하도록 보장.
  const findCached = overrides.findCached ?? vi.fn().mockResolvedValue(undefined);
  const insertCache = overrides.insertCache ?? vi.fn().mockResolvedValue(undefined);
  const toResult = overrides.toResult ?? vi.fn((payload, meta) => ({ ...payload, ...meta }));
  const config = {
    logTag: "saju-test-narrative",
    schema: SCHEMA,
    maxTokens: 4096,
    assertBudget: () => assertSajuBudgetOk(),
    logSpend: (input: { model: string; inputTokens: number; outputTokens: number; krw: number }) => logSajuSpend(input),
    buildUserContent: vi.fn(() => "USER_CONTENT"),
    buildSystemPrompt: vi.fn(() => "SYSTEM_PROMPT"),
    ...overrides,
    findCached,
    insertCache,
    toResult,
  };
  return { config, findCached, insertCache, toResult };
}

const ARGS = {
  profileId: "p1",
  school: "ko" as NarrativeSchool,
  frame: { foo: "bar" },
  frameHash: "hash1",
  modelId: "claude-opus-4-8",
  promptVersion: 2,
  algorithmVersion: 3,
  extra: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  normalizeUsage.mockImplementation((u: { input?: number; output?: number } | undefined) => ({
    inputTokens: u?.input ?? 0,
    outputTokens: u?.output ?? 0,
  }));
});

describe("createNarrativeCache", () => {
  it("cache hit 시 LLM·budget·spend·insert 를 모두 건너뛴다", async () => {
    const { config, findCached, insertCache } = makeConfig({
      findCached: vi.fn().mockResolvedValue({
        narrativeText: "캐시본문",
        sectionsJsonb: { personality: "캐시성격" },
        schoolSpecificJsonb: { note: "캐시학파" },
        citations: ["c1"],
        modelId: "claude-opus-4-8",
        promptVersion: 2,
        algorithmVersion: 3,
        generatedAt: new Date("2026-06-19T00:00:00Z"),
      }),
    });
    const getOrBuild = createNarrativeCache(config);
    const result = await getOrBuild(ARGS) as Record<string, unknown>;

    expect(findCached).toHaveBeenCalledTimes(1);
    expect(analyzeStructured).not.toHaveBeenCalled();
    expect(assertSajuBudgetOk).not.toHaveBeenCalled();
    expect(logSajuSpend).not.toHaveBeenCalled();
    expect(insertCache).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.narrativeText).toBe("캐시본문");
  });

  it("cache miss 시 budget → LLM → spend → insert 순서로 진행한다", async () => {
    analyzeStructured.mockResolvedValue({ object: VALID_OUTPUT, usage: { input: 1000, output: 2000 } });
    const { config, insertCache } = makeConfig();
    const getOrBuild = createNarrativeCache(config);

    const order: string[] = [];
    assertSajuBudgetOk.mockImplementation(async () => { order.push("budget"); });
    analyzeStructured.mockImplementation(async () => { order.push("llm"); return { object: VALID_OUTPUT, usage: { input: 1000, output: 2000 } }; });
    logSajuSpend.mockImplementation(async () => { order.push("spend"); });
    (insertCache as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push("insert"); });

    const result = await getOrBuild(ARGS) as Record<string, unknown>;

    expect(order).toEqual(["budget", "llm", "spend", "insert"]);
    expect(result.fromCache).toBe(false);
    expect(result.narrativeText).toBe("본문");
  });

  it("spend 는 validated output 후에만 기록한다 (LLM 실패 시 미기록)", async () => {
    analyzeStructured.mockRejectedValue(new Error("LLM down"));
    const { config } = makeConfig();
    const getOrBuild = createNarrativeCache(config);

    await expect(getOrBuild(ARGS)).rejects.toThrow("LLM down");
    expect(assertSajuBudgetOk).toHaveBeenCalledTimes(1);
    expect(logSajuSpend).not.toHaveBeenCalled();
  });

  it("ZodError 시 1회 재시도하고 두 번째 성공이면 통과한다", async () => {
    const zodErr = new ZodError([{ code: "custom", path: ["sections"], message: "missing" }]);
    analyzeStructured
      .mockRejectedValueOnce(zodErr)
      .mockResolvedValueOnce({ object: VALID_OUTPUT, usage: { input: 500, output: 800 } });
    const { config } = makeConfig();
    const getOrBuild = createNarrativeCache(config);

    const result = await getOrBuild(ARGS) as Record<string, unknown>;

    expect(analyzeStructured).toHaveBeenCalledTimes(2);
    expect(result.fromCache).toBe(false);
    // 2차 시도 userContent 에 재시도 reminder 가 붙는다
    const secondCallContent = analyzeStructured.mock.calls[1][0] as string;
    expect(secondCallContent).toContain("재시도");
  });

  it("ZodError 가 2회 연속이면 throw 한다", async () => {
    const zodErr = new ZodError([{ code: "custom", path: ["x"], message: "bad" }]);
    analyzeStructured.mockRejectedValue(zodErr);
    const { config } = makeConfig();
    const getOrBuild = createNarrativeCache(config);

    await expect(getOrBuild(ARGS)).rejects.toBeInstanceOf(ZodError);
    expect(analyzeStructured).toHaveBeenCalledTimes(2);
    expect(logSajuSpend).not.toHaveBeenCalled();
  });

  it("JSON.parse/일반 에러는 재시도 없이 즉시 throw 한다", async () => {
    analyzeStructured.mockRejectedValue(new SyntaxError("Unexpected token"));
    const { config } = makeConfig();
    const getOrBuild = createNarrativeCache(config);

    await expect(getOrBuild(ARGS)).rejects.toThrow("Unexpected token");
    expect(analyzeStructured).toHaveBeenCalledTimes(1); // 재시도 안 함
  });

  it("null sections/schoolSpecific 캐시 row 는 자가치유 (regen fall-through)", async () => {
    analyzeStructured.mockResolvedValue({ object: VALID_OUTPUT, usage: { input: 100, output: 200 } });
    const { config, insertCache } = makeConfig({
      findCached: vi.fn().mockResolvedValue({
        narrativeText: "옛본문",
        sectionsJsonb: null, // null → 자가치유
        schoolSpecificJsonb: { note: "x" },
        citations: [],
        modelId: "claude-opus-4-8",
        promptVersion: 2,
        algorithmVersion: 3,
        generatedAt: new Date(),
      }),
    });
    const getOrBuild = createNarrativeCache(config);
    const result = await getOrBuild(ARGS) as Record<string, unknown>;

    // cache hit 으로 끝나지 않고 LLM 재생성 후 insert
    expect(analyzeStructured).toHaveBeenCalledTimes(1);
    expect(insertCache).toHaveBeenCalledTimes(1);
    expect(result.fromCache).toBe(false);
  });

  it("buildUserContent/buildSystemPrompt 결과를 LLM 호출에 전달한다", async () => {
    analyzeStructured.mockResolvedValue({ object: VALID_OUTPUT, usage: { input: 1, output: 1 } });
    const { config } = makeConfig();
    const getOrBuild = createNarrativeCache(config);
    await getOrBuild(ARGS);

    expect(config.buildUserContent).toHaveBeenCalledWith(expect.objectContaining({ frame: ARGS.frame, school: "ko" }));
    expect(config.buildSystemPrompt).toHaveBeenCalledWith("ko");
    const [content, , opts] = analyzeStructured.mock.calls[0];
    expect(content).toBe("USER_CONTENT");
    expect(opts).toMatchObject({ systemPrompt: "SYSTEM_PROMPT", model: "claude-opus-4-8", maxOutputTokens: 4096 });
  });
});
