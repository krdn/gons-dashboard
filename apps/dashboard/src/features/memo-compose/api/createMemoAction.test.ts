import { describe, it, expect, vi, beforeEach } from "vitest";

// auth·createMemo mock — 순수 검증 로직만 태운다.
const createMemoMock = vi.fn();
const classifyMock = vi.hoisted(() => vi.fn());
// after()는 요청 스코프 밖(테스트)에서 throw — 콜백을 캡처해 수동 실행으로 검증.
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
const extractMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  createMemo: (...args: unknown[]) => createMemoMock(...args),
  classifyAndPersistMemoCategory: classifyMock,
}));
vi.mock("@/features/memo-actions", () => ({
  extractAndPersistMemoActions: extractMock,
}));
vi.mock("@/entities/memo/client", () => ({
  deriveTitle: (s: string) => (s.trim() ? s.trim().slice(0, 10) : "(제목 없음)"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => afterCallbacks.push(cb),
}));

import { createMemoAction } from "./createMemoAction";

beforeEach(() => {
  createMemoMock.mockReset().mockResolvedValue({ id: "m1" });
  classifyMock.mockReset().mockResolvedValue({ kind: "classified", category: "idea" });
  extractMock.mockReset().mockResolvedValue({ kind: "extracted", count: 0 });
  afterCallbacks.length = 0;
});

describe("createMemoAction", () => {
  it("빈 cleanedContent는 invalid", async () => {
    const r = await createMemoAction({ source: "text", rawContent: "", cleanedContent: "  " });
    expect(r.kind).toBe("invalid");
    expect(createMemoMock).not.toHaveBeenCalled();
  });
  it("잘못된 source는 invalid", async () => {
    const r = await createMemoAction({ source: "x" as never, rawContent: "a", cleanedContent: "a" });
    expect(r.kind).toBe("invalid");
  });
  it("초과 길이는 invalid", async () => {
    const tooLong = "a".repeat(20_001);
    const r = await createMemoAction({ source: "text", rawContent: tooLong, cleanedContent: "정상" });
    expect(r.kind).toBe("invalid");
    expect(createMemoMock).not.toHaveBeenCalled();
  });
  it("title 미입력 시 cleaned에서 파생해 저장한다", async () => {
    await createMemoAction({ source: "text", rawContent: "원문", cleanedContent: "정리본 텍스트" });
    expect(createMemoMock).toHaveBeenCalledWith(expect.objectContaining({ title: "정리본 텍스트", userId: "u1" }));
  });
  it("성공 시 ok + id", async () => {
    const r = await createMemoAction({ source: "text", rawContent: "a", cleanedContent: "a", title: "제목" });
    expect(r).toEqual({ kind: "ok", id: "m1" });
  });
  it("성공 시 after()로 분류·추출을 예약하고, 콜백은 생성된 memo 행으로 둘 다 호출한다", async () => {
    const memoRow = { id: "m1", title: "제목", cleanedContent: "a", category: null };
    createMemoMock.mockResolvedValue(memoRow);

    await createMemoAction({ source: "text", rawContent: "a", cleanedContent: "a", title: "제목" });
    expect(afterCallbacks.length).toBe(1);
    expect(classifyMock).not.toHaveBeenCalled(); // 응답 전엔 미실행 (큐 비점유)
    expect(extractMock).not.toHaveBeenCalled();

    await afterCallbacks[0]();
    expect(classifyMock).toHaveBeenCalledWith(memoRow);
    expect(extractMock).toHaveBeenCalledWith(memoRow, expect.any(Date));
  });
  it("분류·추출 실패는 저장 결과를 뒤집지 않고 서로 독립이다 (allSettled)", async () => {
    classifyMock.mockRejectedValue(new Error("llm down"));
    extractMock.mockRejectedValue(new Error("llm down"));
    const r = await createMemoAction({ source: "text", rawContent: "a", cleanedContent: "a" });
    expect(r.kind).toBe("ok");
    await expect(Promise.resolve(afterCallbacks[0]())).resolves.not.toThrow();
  });
  it("저장 실패 시 분류를 예약하지 않는다", async () => {
    createMemoMock.mockRejectedValue(new Error("db down"));
    const r = await createMemoAction({ source: "text", rawContent: "a", cleanedContent: "a" });
    expect(r.kind).toBe("failed");
    expect(afterCallbacks.length).toBe(0);
  });
});
