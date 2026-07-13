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

const listCategoriesMock = vi.hoisted(() => vi.fn());
const upsertCategoryMock = vi.hoisted(() => vi.fn());
vi.mock("./categoryRepo", () => ({
  listCategories: listCategoriesMock,
  upsertCategory: upsertCategoryMock,
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
  listCategoriesMock.mockReset();
  upsertCategoryMock.mockReset();
  listCategoriesMock.mockResolvedValue([
    { id: "idea", labelKo: "아이디어" },
    { id: "todo", labelKo: "할 일" },
  ]);
  upsertCategoryMock.mockResolvedValue(undefined);
});

// analyzeStructured를 mock하면 내부 Zod 검증이 사라지므로 스키마를 직접 가드.
describe("MemoCategoryResponseSchema", () => {
  test("유효 slug + 한글 라벨을 통과시킨다", () => {
    const r = MemoCategoryResponseSchema.safeParse({ category: "meeting-log", labelKo: "회의록" });
    expect(r.success).toBe(true);
  });

  test("대문자·공백·한글 slug를 거부한다", () => {
    expect(MemoCategoryResponseSchema.safeParse({ category: "Meeting", labelKo: "회의록" }).success).toBe(false);
    expect(MemoCategoryResponseSchema.safeParse({ category: "meeting log", labelKo: "회의록" }).success).toBe(false);
    expect(MemoCategoryResponseSchema.safeParse({ category: "회의록", labelKo: "회의록" }).success).toBe(false);
  });

  test("빈 라벨·20자 초과 라벨을 거부한다", () => {
    expect(MemoCategoryResponseSchema.safeParse({ category: "idea", labelKo: "" }).success).toBe(false);
    expect(MemoCategoryResponseSchema.safeParse({ category: "idea", labelKo: "가".repeat(21) }).success).toBe(false);
  });
});

describe("classifyMemoContent", () => {
  test("ok — LLM 결과 카테고리·라벨을 반환하고 본문을 2,000자로 절단한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "reference", labelKo: "참고" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await classifyMemoContent({
      title: "테스트",
      content: "가".repeat(5_000),
    });

    expect(result).toEqual({ kind: "ok", category: "reference", labelKo: "참고" });
    const prompt = analyzeStructuredMock.mock.calls[0][0] as string;
    expect(prompt.length).toBeLessThan(2_100);
  });

  test("게이트웨이 실패는 llm-unavailable로 흡수한다 (throw 안 함)", async () => {
    analyzeStructuredMock.mockRejectedValue(new Error("proxy down"));

    await expect(
      classifyMemoContent({ title: "t", content: "c" }),
    ).resolves.toEqual({ kind: "llm-unavailable" });
  });

  test("DB 카테고리 목록 조회 실패 시 시드 fallback으로 계속 진행한다", async () => {
    listCategoriesMock.mockRejectedValue(new Error("db down"));
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "idea", labelKo: "아이디어" },
      usage: {},
    });

    const result = await classifyMemoContent({ title: "t", content: "c" });

    expect(result).toEqual({ kind: "ok", category: "idea", labelKo: "아이디어" });
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

  test("미분류 메모는 분류 후 upsertCategory→setMemoCategory 순서로 영속화한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "meeting-log", labelKo: "회의록" },
      usage: {},
    });

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "classified", category: "meeting-log" });
    expect(upsertCategoryMock).toHaveBeenCalledWith("meeting-log", "회의록");
    expect(setMemoCategoryMock).toHaveBeenCalledWith(baseMemo.id, "meeting-log");

    const upsertOrder = upsertCategoryMock.mock.invocationCallOrder[0];
    const setOrder = setMemoCategoryMock.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(setOrder);
  });

  test("LLM이 무효 slug를 반환하면 etc/기타로 fallback한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "INVALID SLUG", labelKo: "잘못됨" },
      usage: {},
    });

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "classified", category: "etc" });
    expect(upsertCategoryMock).toHaveBeenCalledWith("etc", "기타");
    expect(setMemoCategoryMock).toHaveBeenCalledWith(baseMemo.id, "etc");
  });

  test("LLM 실패 시 영속화하지 않는다 (null 유지 → cron 재시도)", async () => {
    analyzeStructuredMock.mockRejectedValue(new Error("proxy down"));

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "llm-unavailable" });
    expect(setMemoCategoryMock).not.toHaveBeenCalled();
    expect(upsertCategoryMock).not.toHaveBeenCalled();
  });
});
