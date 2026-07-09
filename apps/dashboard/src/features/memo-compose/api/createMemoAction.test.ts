import { describe, it, expect, vi, beforeEach } from "vitest";

// auth·createMemo mock — 순수 검증 로직만 태운다.
const createMemoMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  createMemo: (...args: unknown[]) => createMemoMock(...args),
}));
vi.mock("@/entities/memo/client", () => ({
  deriveTitle: (s: string) => (s.trim() ? s.trim().slice(0, 10) : "(제목 없음)"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createMemoAction } from "./createMemoAction";

beforeEach(() => createMemoMock.mockReset().mockResolvedValue({ id: "m1" }));

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
  it("title 미입력 시 cleaned에서 파생해 저장한다", async () => {
    await createMemoAction({ source: "text", rawContent: "원문", cleanedContent: "정리본 텍스트" });
    expect(createMemoMock).toHaveBeenCalledWith(expect.objectContaining({ title: "정리본 텍스트", userId: "u1" }));
  });
  it("성공 시 ok + id", async () => {
    const r = await createMemoAction({ source: "text", rawContent: "a", cleanedContent: "a", title: "제목" });
    expect(r).toEqual({ kind: "ok", id: "m1" });
  });
});
