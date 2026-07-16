import { describe, it, expect, vi, beforeEach } from "vitest";

const searchMock = vi.fn();
const listMock = vi.fn();
const authMock = vi.fn(async () => ({ user: { id: "u1" } }) as { user: { id: string } } | null);
vi.mock("@/shared/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/entities/memo/server", () => ({
  searchMemos: (...a: unknown[]) => searchMock(...a),
  listMemos: (...a: unknown[]) => listMock(...a),
  isValidCategorySlug: (v: unknown) => typeof v === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(v),
}));

import { searchMemosAction } from "./searchMemosAction";

beforeEach(() => {
  searchMock.mockReset().mockResolvedValue({ memos: [{ id: "m1" }], truncated: false });
  listMock.mockReset().mockResolvedValue([{ id: "m2" }]);
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
});

describe("searchMemosAction", () => {
  it("비로그인은 throw", async () => {
    authMock.mockResolvedValue(null);
    await expect(searchMemosAction("q")).rejects.toThrow("Unauthorized");
  });

  it("빈 쿼리 + 카테고리 없음은 repo 호출 없이 빈 결과", async () => {
    const r = await searchMemosAction("   ");
    expect(r).toEqual({ kind: "ok", memos: [], truncated: false });
    expect(searchMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("세션 유저 id로 검색한다 (카테고리 미지정은 null 전달)", async () => {
    const r = await searchMemosAction("위약금");
    expect(searchMock).toHaveBeenCalledWith("u1", "위약금", null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.memos).toEqual([{ id: "m1" }]);
  });

  it("repo 실패는 failed로 감싼다", async () => {
    searchMock.mockRejectedValue(new Error("db down"));
    expect((await searchMemosAction("q")).kind).toBe("failed");
  });
});

describe("searchMemosAction — 카테고리 필터", () => {
  it("빈 쿼리 + 카테고리는 필터된 목록 조회 (서버 WHERE)", async () => {
    const r = await searchMemosAction("", "idea");
    expect(listMock).toHaveBeenCalledWith("u1", "idea");
    expect(searchMock).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "ok", memos: [{ id: "m2" }], truncated: false });
  });

  it("검색어 + 카테고리는 둘 다 repo 조건으로 전달", async () => {
    await searchMemosAction("회의", "todo");
    expect(searchMock).toHaveBeenCalledWith("u1", "회의", "todo");
  });

  it("잘못된 slug 형식은 repo 호출 없이 failed (방어)", async () => {
    const r = await searchMemosAction("회의", "한글카테고리");
    expect(r.kind).toBe("failed");
    expect(searchMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("필터 목록 조회 실패는 failed로 감싼다", async () => {
    listMock.mockRejectedValue(new Error("db down"));
    expect((await searchMemosAction("", "idea")).kind).toBe("failed");
  });
});
