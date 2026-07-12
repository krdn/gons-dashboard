import { beforeEach, describe, expect, it, vi } from "vitest";

const analyzeStructuredMock = vi.hoisted(() => vi.fn());
// importOriginal 병합 — normalizeUsage 실 구현 유지 (mock 누락 함정, PR #294 리뷰 전례).
vi.mock("@krdn/llm-gateway/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@krdn/llm-gateway/gateway")>()),
  analyzeStructured: analyzeStructuredMock,
}));

const insertAndMarkMock = vi.hoisted(() => vi.fn());
vi.mock("@/entities/memo/server", () => ({
  insertActionItemsAndMark: insertAndMarkMock,
  ACTION_ITEM_KINDS: ["todo", "event"],
}));

vi.mock("@/shared/config/env", () => ({
  env: { ANTHROPIC_BASE_URL: "http://proxy.test", ANTHROPIC_API_KEY: "test-key" },
}));

import { ActionExtractionSchema, extractAndPersistMemoActions } from "./extractMemoActions";

const NOW = new Date("2026-07-12T13:30:00Z"); // 2026-07-12 (일) 22:30 KST
const baseMemo = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "u1",
  title: "통신사 정리",
  cleanedContent: "다음 주 화요일에 LG 위약금 문의해야지",
  actionsExtractedAt: null as Date | null,
};

beforeEach(() => {
  analyzeStructuredMock.mockReset().mockResolvedValue({
    object: { actions: [] },
    usage: { inputTokens: 50, outputTokens: 10 },
  });
  insertAndMarkMock.mockReset().mockImplementation(
    async (_memoId: string, _userId: string, items: unknown[]) => items.length,
  );
});

// analyzeStructured mock 시 내부 Zod 검증이 사라지므로 스키마 직접 가드.
describe("ActionExtractionSchema", () => {
  it("유효 액션 배열·빈 배열을 통과시킨다", () => {
    expect(ActionExtractionSchema.safeParse({ actions: [] }).success).toBe(true);
    expect(
      ActionExtractionSchema.safeParse({
        actions: [
          { kind: "todo", title: "LG 위약금 문의", dueAtIso: "2026-07-14T09:00:00+09:00", allDay: false },
        ],
      }).success,
    ).toBe(true);
  });
  it("무효 kind·빈 title·6개 초과를 거부한다", () => {
    const item = { kind: "todo", title: "t", dueAtIso: null, allDay: false };
    expect(
      ActionExtractionSchema.safeParse({ actions: [{ ...item, kind: "meeting" }] }).success,
    ).toBe(false);
    expect(
      ActionExtractionSchema.safeParse({ actions: [{ ...item, title: "" }] }).success,
    ).toBe(false);
    expect(
      ActionExtractionSchema.safeParse({ actions: Array.from({ length: 6 }, () => item) }).success,
    ).toBe(false);
  });
});

describe("extractAndPersistMemoActions", () => {
  it("이미 추출된 메모는 skip — LLM 미호출", async () => {
    const r = await extractAndPersistMemoActions(
      { ...baseMemo, actionsExtractedAt: new Date() },
      NOW,
    );
    expect(r).toEqual({ kind: "already-extracted" });
    expect(analyzeStructuredMock).not.toHaveBeenCalled();
  });

  it("프롬프트에 현재 KST 일시(상대 날짜 기준점)와 제목·본문이 들어간다", async () => {
    await extractAndPersistMemoActions(baseMemo, NOW);
    const prompt = analyzeStructuredMock.mock.calls[0][0] as string;
    expect(prompt).toContain("2026-07-12 (일) 22:30 KST");
    expect(prompt).toContain("통신사 정리");
    expect(prompt).toContain("LG 위약금");
  });

  it("추출 결과를 dueAt 파싱과 함께 영속화하고 0건도 마킹한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: {
        actions: [
          { kind: "todo", title: "LG 위약금 문의", dueAtIso: "2026-07-14T09:00:00+09:00", allDay: false },
          { kind: "todo", title: "기한 없음", dueAtIso: null, allDay: false },
        ],
      },
      usage: {},
    });

    const r = await extractAndPersistMemoActions(baseMemo, NOW);
    expect(r).toEqual({ kind: "extracted", count: 2 });
    expect(insertAndMarkMock).toHaveBeenCalledWith(baseMemo.id, "u1", [
      { kind: "todo", title: "LG 위약금 문의", dueAt: new Date("2026-07-14T00:00:00Z"), allDay: false },
      { kind: "todo", title: "기한 없음", dueAt: null, allDay: false },
    ]);
  });

  it("무효 dueAtIso는 null로 강등하되 제안은 유지한다", async () => {
    analyzeStructuredMock.mockResolvedValue({
      object: { actions: [{ kind: "event", title: "회의", dueAtIso: "다음주쯤", allDay: true }] },
      usage: {},
    });
    await extractAndPersistMemoActions(baseMemo, NOW);
    expect(insertAndMarkMock).toHaveBeenCalledWith(baseMemo.id, "u1", [
      { kind: "event", title: "회의", dueAt: null, allDay: true },
    ]);
  });

  it("빈 결과(액션 없음)도 마킹 — 재평가 차단", async () => {
    const r = await extractAndPersistMemoActions(baseMemo, NOW);
    expect(r).toEqual({ kind: "extracted", count: 0 });
    expect(insertAndMarkMock).toHaveBeenCalledWith(baseMemo.id, "u1", []);
  });

  it("LLM 실패는 마킹 없이 llm-unavailable — cron이 48h 창에서 재시도", async () => {
    analyzeStructuredMock.mockRejectedValue(new Error("proxy down"));
    const r = await extractAndPersistMemoActions(baseMemo, NOW);
    expect(r).toEqual({ kind: "llm-unavailable" });
    expect(insertAndMarkMock).not.toHaveBeenCalled();
  });
});
