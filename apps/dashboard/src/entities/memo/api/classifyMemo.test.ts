import { beforeEach, describe, expect, test, vi } from "vitest";

const analyzeStructuredMock = vi.hoisted(() => vi.fn());
// importOriginal 병합 — normalizeUsage 등 실 구현 유지 (mock 누락 시 logLlmSpend가
// 항상 TypeError-swallow 경로로 빠져 관측 코드가 한 번도 실행되지 않는 함정, PR #161 전례).
vi.mock("@krdn/llm-gateway/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@krdn/llm-gateway/gateway")>()),
  analyzeStructured: analyzeStructuredMock,
}));

const setMemoCategoryMock = vi.hoisted(() => vi.fn());
vi.mock("./memoRepo", () => ({
  setMemoCategory: setMemoCategoryMock,
}));

// env 검증(Zod) 회피 — gatewayDefaults가 env를 읽는다.
vi.mock("@/shared/config/env", () => ({
  env: { ANTHROPIC_BASE_URL: "http://proxy.test", ANTHROPIC_API_KEY: "test-key" },
}));

import {
  MemoCategoryResponseSchema,
  classifyMemoContent,
  classifyAndPersistMemoCategory,
} from "./classifyMemo";

beforeEach(() => {
  analyzeStructuredMock.mockReset();
  setMemoCategoryMock.mockReset();
});

// analyzeStructured를 mock하면 내부 Zod 검증이 사라지므로 스키마를 직접 가드.
describe("MemoCategoryResponseSchema", () => {
  test("유효 카테고리를 통과시킨다", () => {
    expect(
      MemoCategoryResponseSchema.safeParse({ category: "idea" }).success,
    ).toBe(true);
    expect(
      MemoCategoryResponseSchema.safeParse({ category: "etc" }).success,
    ).toBe(true);
  });

  test("무효 카테고리·형태를 거부한다", () => {
    expect(
      MemoCategoryResponseSchema.safeParse({ category: "unknown" }).success,
    ).toBe(false);
    expect(MemoCategoryResponseSchema.safeParse({}).success).toBe(false);
    expect(MemoCategoryResponseSchema.safeParse(null).success).toBe(false);
  });
});

describe("classifyMemoContent", () => {
  test("ok — LLM 결과 카테고리를 반환하고 본문을 2,000자로 절단한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "reference" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await classifyMemoContent({
      title: "테스트",
      content: "가".repeat(5_000),
    });

    expect(result).toEqual({ kind: "ok", category: "reference" });
    const prompt = analyzeStructuredMock.mock.calls[0][0] as string;
    expect(prompt.length).toBeLessThan(2_100);
  });

  test("게이트웨이 실패는 llm-unavailable로 흡수한다 (throw 안 함)", async () => {
    analyzeStructuredMock.mockRejectedValue(new Error("proxy down"));

    await expect(
      classifyMemoContent({ title: "t", content: "c" }),
    ).resolves.toEqual({ kind: "llm-unavailable" });
  });
});

describe("classifyAndPersistMemoCategory", () => {
  const baseMemo = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "제목",
    cleanedContent: "본문",
  };

  test("이미 분류된 메모는 LLM 미호출 skip", async () => {
    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: "idea",
    });

    expect(result).toEqual({ kind: "already-classified" });
    expect(analyzeStructuredMock).not.toHaveBeenCalled();
    expect(setMemoCategoryMock).not.toHaveBeenCalled();
  });

  test("미분류 메모는 분류 후 영속화한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "todo" },
      usage: {},
    });

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "classified", category: "todo" });
    expect(setMemoCategoryMock).toHaveBeenCalledWith(baseMemo.id, "todo");
  });

  test("LLM 실패 시 영속화하지 않는다 (null 유지 → cron 재시도)", async () => {
    analyzeStructuredMock.mockRejectedValue(new Error("proxy down"));

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "llm-unavailable" });
    expect(setMemoCategoryMock).not.toHaveBeenCalled();
  });
});
