import { beforeEach, describe, expect, test, vi } from "vitest";

const analyzeStructuredMock = vi.hoisted(() => vi.fn());
// importOriginal 병합 — normalizeUsage 등 실 구현 유지 (mock 누락 시 logLlmSpend가
// 항상 TypeError-swallow 경로로 빠져 관측 코드가 한 번도 실행되지 않는 함정, PR #161 전례).
vi.mock("@krdn/llm-gateway/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@krdn/llm-gateway/gateway")>()),
  analyzeStructured: analyzeStructuredMock,
}));

const fillCategoryMock = vi.hoisted(() => vi.fn());
vi.mock("./memoRepo", () => ({
  fillMemoCategoryWithTag: fillCategoryMock,
}));

const listCategoriesMock = vi.hoisted(() => vi.fn());
vi.mock("./categoryRepo", () => ({
  listCategories: listCategoriesMock,
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
  // true = 미분류 행을 채움 (fill-only 트랜잭션 성공) — 정상 경로 기본값.
  fillCategoryMock.mockReset().mockResolvedValue(true);
  listCategoriesMock.mockReset();
  listCategoriesMock.mockResolvedValue([
    { id: "idea", labelKo: "아이디어" },
    { id: "todo", labelKo: "할 일" },
  ]);
});

// analyzeStructured를 mock하면 내부 Zod 검증이 사라지므로 스키마를 직접 가드.
// category slug 형식은 스키마가 아닌 앱 계층(classifyAndPersistMemoCategory)에서 검증한다 —
// 스키마 regex 위반은 analyzeStructured throw→llm-unavailable로 잡혀 etc fallback에 도달 못 하기 때문.
describe("MemoCategoryResponseSchema", () => {
  test("category·라벨이 비어있지 않으면 통과시킨다 (형식 무관하게 파싱)", () => {
    expect(MemoCategoryResponseSchema.safeParse({ category: "meeting-log", labelKo: "회의록" }).success).toBe(true);
    // 무효 형식 slug도 스키마는 통과 — 형식 검증은 앱 계층으로 이동.
    expect(MemoCategoryResponseSchema.safeParse({ category: "INVALID SLUG", labelKo: "잘못됨" }).success).toBe(true);
  });

  test("빈 category·빈 라벨·20자 초과 라벨을 거부한다", () => {
    expect(MemoCategoryResponseSchema.safeParse({ category: "", labelKo: "회의록" }).success).toBe(false);
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
    expect(fillCategoryMock).not.toHaveBeenCalled();
  });

  test("미분류 메모는 분류 후 태그 등록+채움 트랜잭션에 라벨까지 위임한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "meeting-log", labelKo: "회의록" },
      usage: {},
    });

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "classified", category: "meeting-log" });
    // 태그 INSERT(FK 선행)와 fill UPDATE의 순서·원자성은 repo 트랜잭션이 보장
    // (memo-fill-category 통합 테스트가 rollback까지 검증).
    expect(fillCategoryMock).toHaveBeenCalledWith(baseMemo.id, "meeting-log", "회의록");
  });

  test("LLM이 무효 slug를 반환하면 etc/기타로 fallback한다", async () => {
    // 실제 analyzeStructured도 이 응답을 파싱 통과시킨다 (스키마가 category regex를 안 하므로).
    // 형식 검증은 여기 앱 계층에서 수행 → etc 강등. 스키마에 regex를 두면 이 경로가 죽고
    // 무효 slug가 llm-unavailable로 빠져 영원히 미분류가 된다 (Codex 리뷰 발견).
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "INVALID SLUG", labelKo: "잘못됨" },
      usage: {},
    });

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "classified", category: "etc" });
    expect(fillCategoryMock).toHaveBeenCalledWith(baseMemo.id, "etc", "기타");
  });

  test("LLM 대기 중 수동 정정이 먼저 도착하면 덮지 않고 skip한다 (fill-only 경합)", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { category: "reference", labelKo: "참고" },
      usage: {},
    });
    // read 체크(category: null) 통과 후 write 시점엔 이미 수동 정정됨 — rollback.
    fillCategoryMock.mockResolvedValue(false);

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "already-classified" });
  });

  test("LLM 실패 시 영속화하지 않는다 (null 유지 → cron 재시도)", async () => {
    analyzeStructuredMock.mockRejectedValue(new Error("proxy down"));

    const result = await classifyAndPersistMemoCategory({
      ...baseMemo,
      category: null,
    });

    expect(result).toEqual({ kind: "llm-unavailable" });
    expect(fillCategoryMock).not.toHaveBeenCalled();
  });
});
