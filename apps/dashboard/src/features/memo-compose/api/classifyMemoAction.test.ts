import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getMemoMock = vi.hoisted(() => vi.fn());
const classifyAndPersistMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/auth", () => ({ auth: authMock }));
vi.mock("@/entities/memo/server", () => ({
  getMemo: getMemoMock,
  classifyAndPersistMemoCategory: classifyAndPersistMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { classifyMemoAction } from "./classifyMemoAction";

const MEMO_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  getMemoMock.mockReset();
  classifyAndPersistMock.mockReset();
});

describe("classifyMemoAction", () => {
  it("비로그인은 throw (기존 액션 관례)", async () => {
    authMock.mockResolvedValue(null);
    await expect(classifyMemoAction(MEMO_ID)).rejects.toThrow("Unauthorized");
    expect(getMemoMock).not.toHaveBeenCalled();
  });

  it("타인/미존재 메모는 not-found — LLM 미호출", async () => {
    getMemoMock.mockResolvedValue(null);
    const r = await classifyMemoAction(MEMO_ID);
    expect(r).toEqual({ kind: "not-found" });
    expect(getMemoMock).toHaveBeenCalledWith("u1", MEMO_ID);
    expect(classifyAndPersistMock).not.toHaveBeenCalled();
  });

  it("소유 메모는 분류 결과를 그대로 반환한다", async () => {
    const memo = { id: MEMO_ID, title: "t", cleanedContent: "c", category: null };
    getMemoMock.mockResolvedValue(memo);
    classifyAndPersistMock.mockResolvedValue({ kind: "classified", category: "idea" });

    const r = await classifyMemoAction(MEMO_ID);
    expect(r).toEqual({ kind: "classified", category: "idea" });
    expect(classifyAndPersistMock).toHaveBeenCalledWith(memo);
  });

  it("repo throw는 failed로 흡수한다", async () => {
    getMemoMock.mockRejectedValue(new Error("db down"));
    const r = await classifyMemoAction(MEMO_ID);
    expect(r).toEqual({ kind: "failed" });
  });
});
