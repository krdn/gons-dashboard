import { beforeEach, describe, expect, it, vi } from "vitest";

const analyzeStructuredMock = vi.hoisted(() => vi.fn());
// importOriginal 병합 — normalizeUsage 실 구현 유지 (mock 누락 함정, PR #294 리뷰 전례).
vi.mock("@krdn/llm-gateway/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@krdn/llm-gateway/gateway")>()),
  analyzeStructured: analyzeStructuredMock,
}));

const hasDigestMock = vi.hoisted(() => vi.fn());
const insertDigestMock = vi.hoisted(() => vi.fn());
const getLatestDigestMock = vi.hoisted(() => vi.fn());
const listMemosBetweenMock = vi.hoisted(() => vi.fn());
const listMemosOlderThanMock = vi.hoisted(() => vi.fn());
vi.mock("@/entities/memo/server", () => ({
  hasDigest: hasDigestMock,
  insertDigest: insertDigestMock,
  getLatestDigest: getLatestDigestMock,
  listMemosBetween: listMemosBetweenMock,
  listMemosOlderThan: listMemosOlderThanMock,
}));

const sendPushToUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/push", () => ({ sendPushToUser: sendPushToUserMock }));

vi.mock("@/shared/config/env", () => ({
  env: { ANTHROPIC_BASE_URL: "http://proxy.test", ANTHROPIC_API_KEY: "test-key" },
}));

import { DigestSummarySchema, generateWeeklyDigest } from "./generateWeeklyDigest";

const USER = "u1";
// 일요일 2026-07-12 22:00 KST — weekEnd 2026-07-12.
const NOW = new Date("2026-07-12T13:00:00Z");
const OLD_DAYS_MS = 24 * 60 * 60 * 1000;

function memo(id: string, title: string, ageDays: number, category: string | null = null) {
  return {
    id,
    userId: USER,
    source: "text",
    title,
    rawContent: title,
    cleanedContent: `${title} 본문`,
    category,
    createdAt: new Date(NOW.getTime() - ageDays * OLD_DAYS_MS),
    updatedAt: new Date(NOW.getTime() - ageDays * OLD_DAYS_MS),
  };
}

beforeEach(() => {
  analyzeStructuredMock.mockReset().mockResolvedValue({
    object: { summary: "이번 주 요약\n둘째 줄" },
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  hasDigestMock.mockReset().mockResolvedValue(false);
  insertDigestMock.mockReset().mockImplementation(async (input: unknown) => input);
  getLatestDigestMock.mockReset().mockResolvedValue(null); // 첫 다이제스트 — 현재 주만
  listMemosBetweenMock.mockReset().mockResolvedValue([memo("m1", "회의", 2)]);
  listMemosOlderThanMock.mockReset().mockResolvedValue([]);
  sendPushToUserMock.mockReset().mockResolvedValue({ total: 1, sent: 1, expired: 0, errors: 0 });
});

// analyzeStructured mock 시 내부 Zod 검증이 사라지므로 스키마 직접 가드.
describe("DigestSummarySchema", () => {
  it("비어있지 않은 summary만 허용", () => {
    expect(DigestSummarySchema.safeParse({ summary: "ok" }).success).toBe(true);
    expect(DigestSummarySchema.safeParse({ summary: "" }).success).toBe(false);
    expect(DigestSummarySchema.safeParse({}).success).toBe(false);
  });
});

describe("generateWeeklyDigest", () => {
  it("이미 생성된 주는 skip — LLM·insert·push 미호출", async () => {
    hasDigestMock.mockResolvedValue(true);
    const r = await generateWeeklyDigest(USER, NOW);
    expect(r).toEqual({ kind: "already-generated" });
    expect(analyzeStructuredMock).not.toHaveBeenCalled();
    expect(insertDigestMock).not.toHaveBeenCalled();
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("빈 주는 marker 행만 삽입 — LLM·push 미호출", async () => {
    listMemosBetweenMock.mockResolvedValue([]);
    const r = await generateWeeklyDigest(USER, NOW);
    expect(r).toEqual({ kind: "empty-week" });
    expect(insertDigestMock).toHaveBeenCalledWith({
      userId: USER,
      weekEnd: "2026-07-12",
      summary: "",
      memoCount: 0,
      resurfacedMemoIds: [],
    });
    expect(analyzeStructuredMock).not.toHaveBeenCalled();
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("정상 경로 — 요약·재부상·insert·push, 창 [일 19:00, 일 19:00) 전달", async () => {
    listMemosBetweenMock.mockResolvedValue([memo("m1", "회의", 2, "todo"), memo("m2", "장보기", 3)]);
    listMemosOlderThanMock.mockResolvedValue([memo("old1", "옛 메모", 90)]);

    const r = await generateWeeklyDigest(USER, NOW);
    expect(r).toEqual({
      kind: "generated",
      weekEnd: "2026-07-12",
      memoCount: 2,
      resurfacedCount: 1,
      push: { total: 1, sent: 1 },
    });
    // 창 경계 — computeDigestWindow와 일치
    expect(listMemosBetweenMock).toHaveBeenCalledWith(
      USER,
      new Date("2026-07-05T10:00:00.000Z"),
      new Date("2026-07-12T10:00:00.000Z"),
    );
    expect(insertDigestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        weekEnd: "2026-07-12",
        summary: "이번 주 요약\n둘째 줄",
        memoCount: 2,
        resurfacedMemoIds: ["old1"],
      }),
    );
    // push body는 요약 첫 줄만
    expect(sendPushToUserMock).toHaveBeenCalledWith(USER, {
      title: "주간 메모 다이제스트",
      body: "지난주 메모 2개 — 이번 주 요약",
      url: "/",
      tag: "memo-digest",
    });
  });

  it("LLM 실패는 throw — 행 미삽입 (다음 날 재시도)", async () => {
    analyzeStructuredMock.mockRejectedValue(new Error("proxy down"));
    await expect(generateWeeklyDigest(USER, NOW)).rejects.toThrow("proxy down");
    expect(insertDigestMock).not.toHaveBeenCalled();
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("insert 충돌(동시 실행) — push 없이 already-generated", async () => {
    insertDigestMock.mockResolvedValue(null);
    const r = await generateWeeklyDigest(USER, NOW);
    expect(r).toEqual({ kind: "already-generated" });
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("프롬프트에 카테고리 라벨과 제목이 들어간다", async () => {
    listMemosBetweenMock.mockResolvedValue([memo("m1", "회의 준비", 2, "todo")]);
    await generateWeeklyDigest(USER, NOW);
    const prompt = analyzeStructuredMock.mock.calls[0][0] as string;
    expect(prompt).toContain("[할 일] 회의 준비");
  });

  it("누락 주 백필 — 과거 창은 push 억제, 현재 주만 발송", async () => {
    // 마지막 기록이 2주 전 → 2026-07-05(누락)와 2026-07-12(현재) 두 창 생성.
    getLatestDigestMock.mockResolvedValue({ weekEnd: "2026-06-28" });

    const r = await generateWeeklyDigest(USER, NOW);
    expect(insertDigestMock).toHaveBeenCalledTimes(2);
    expect(insertDigestMock.mock.calls.map((c) => (c[0] as { weekEnd: string }).weekEnd)).toEqual([
      "2026-07-05",
      "2026-07-12",
    ]);
    // 과거 창(7/5)은 [6/28 19:00, 7/5 19:00) — computeDigestWindow와 동일 경계
    expect(listMemosBetweenMock).toHaveBeenNthCalledWith(
      1,
      USER,
      new Date("2026-06-28T10:00:00.000Z"),
      new Date("2026-07-05T10:00:00.000Z"),
    );
    // push는 현재 주 1회만
    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe("generated");
    expect(r.backfilled).toBe(1);
  });

  it("백필 중간 실패는 throw — 생성된 창까지는 남아 다음 실행이 이어간다", async () => {
    getLatestDigestMock.mockResolvedValue({ weekEnd: "2026-06-28" });
    // 첫 창(7/5)은 성공, 둘째 창(7/12)에서 LLM 실패.
    analyzeStructuredMock
      .mockResolvedValueOnce({ object: { summary: "7/5 요약" }, usage: {} })
      .mockRejectedValueOnce(new Error("proxy down"));

    await expect(generateWeeklyDigest(USER, NOW)).rejects.toThrow("proxy down");
    expect(insertDigestMock).toHaveBeenCalledTimes(1); // 7/5만 기록
    expect(sendPushToUserMock).not.toHaveBeenCalled(); // 과거 창이라 push 억제
  });
});
