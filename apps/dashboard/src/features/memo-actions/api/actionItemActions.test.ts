import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const updateStatusMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/auth", () => ({ auth: authMock }));
vi.mock("@/entities/memo/server", () => ({ updateActionItemStatus: updateStatusMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateActionItemStatusAction } from "./actionItemActions";

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  updateStatusMock.mockReset().mockResolvedValue({ id: ID, status: "accepted" });
});

describe("updateActionItemStatusAction", () => {
  it("비로그인은 throw (기존 액션 관례)", async () => {
    authMock.mockResolvedValue(null);
    await expect(updateActionItemStatusAction(ID, "accepted")).rejects.toThrow("Unauthorized");
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it("proposed 등 허용 외 목적지는 failed — repo 미호출", async () => {
    const r = await updateActionItemStatusAction(ID, "proposed" as never);
    expect(r).toEqual({ kind: "failed" });
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it("성공 시 ok — userId 스코프로 repo 호출", async () => {
    const r = await updateActionItemStatusAction(ID, "accepted");
    expect(r).toEqual({ kind: "ok" });
    expect(updateStatusMock).toHaveBeenCalledWith("u1", ID, "accepted");
  });

  it("0-row(타인·불법 전이·경합)는 not-found", async () => {
    updateStatusMock.mockResolvedValue(null);
    const r = await updateActionItemStatusAction(ID, "done");
    expect(r).toEqual({ kind: "not-found" });
  });

  it("repo throw는 failed로 흡수", async () => {
    updateStatusMock.mockRejectedValue(new Error("db down"));
    const r = await updateActionItemStatusAction(ID, "dismissed");
    expect(r).toEqual({ kind: "failed" });
  });
});
