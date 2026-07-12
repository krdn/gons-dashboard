import { describe, it, expect, vi, beforeEach } from "vitest";

const searchMock = vi.fn();
const authMock = vi.fn(async () => ({ user: { id: "u1" } }) as { user: { id: string } } | null);
vi.mock("@/shared/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/entities/memo/server", () => ({
  searchMemos: (...a: unknown[]) => searchMock(...a),
}));

import { searchMemosAction } from "./searchMemosAction";

beforeEach(() => {
  searchMock.mockReset().mockResolvedValue([{ id: "m1" }]);
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
});

describe("searchMemosAction", () => {
  it("비로그인은 throw", async () => {
    authMock.mockResolvedValue(null);
    await expect(searchMemosAction("q")).rejects.toThrow("Unauthorized");
  });

  it("빈 쿼리는 repo 호출 없이 빈 결과", async () => {
    const r = await searchMemosAction("   ");
    expect(r).toEqual({ kind: "ok", memos: [] });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("세션 유저 id로 검색한다", async () => {
    const r = await searchMemosAction("위약금");
    expect(searchMock).toHaveBeenCalledWith("u1", "위약금");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.memos).toEqual([{ id: "m1" }]);
  });

  it("repo 실패는 failed로 감싼다", async () => {
    searchMock.mockRejectedValue(new Error("db down"));
    expect((await searchMemosAction("q")).kind).toBe("failed");
  });
});
