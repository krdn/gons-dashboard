import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  updateMemo: (...a: unknown[]) => updateMock(...a),
  deleteMemo: (...a: unknown[]) => deleteMock(...a),
}));
vi.mock("@/entities/memo/client", () => ({ deriveTitle: (s: string) => s.trim().slice(0, 10) || "(제목 없음)" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateMemoAction } from "./updateMemoAction";
import { deleteMemoAction } from "./deleteMemoAction";

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ id: "m1" });
  deleteMock.mockReset().mockResolvedValue(true);
});

describe("updateMemoAction", () => {
  it("빈 cleanedContent는 invalid", async () => {
    expect((await updateMemoAction("m1", { cleanedContent: "  " })).kind).toBe("invalid");
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("title 미입력 시 파생", async () => {
    await updateMemoAction("m1", { cleanedContent: "새 정리본" });
    expect(updateMock).toHaveBeenCalledWith("u1", "m1", expect.objectContaining({ title: "새 정리본" }));
  });
  it("소유 아님(updateMemo null)이면 not-found", async () => {
    updateMock.mockResolvedValue(null);
    expect((await updateMemoAction("m1", { cleanedContent: "x" })).kind).toBe("not-found");
  });
});

describe("deleteMemoAction", () => {
  it("삭제 성공 ok", async () => {
    expect((await deleteMemoAction("m1")).kind).toBe("ok");
  });
  it("소유 아님(false)이면 not-found", async () => {
    deleteMock.mockResolvedValue(false);
    expect((await deleteMemoAction("m1")).kind).toBe("not-found");
  });
});
