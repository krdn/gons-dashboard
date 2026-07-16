import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const deleteMock = vi.fn();
const setCategoryMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  updateMemo: (...a: unknown[]) => updateMock(...a),
  deleteMemo: (...a: unknown[]) => deleteMock(...a),
  setMemoCategoryOwned: (...a: unknown[]) => setCategoryMock(...a),
  // 실제 CATEGORY_SLUG_RE와 동치 (entities/memo/model/category.ts).
  isValidCategorySlug: (v: unknown) => typeof v === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(v),
}));
vi.mock("@/entities/memo/client", () => ({ deriveTitle: (s: string) => s.trim().slice(0, 10) || "(제목 없음)" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateMemoAction } from "./updateMemoAction";
import { deleteMemoAction } from "./deleteMemoAction";
import { updateMemoCategoryAction } from "./updateMemoCategoryAction";

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ id: "m1" });
  deleteMock.mockReset().mockResolvedValue(true);
  setCategoryMock.mockReset().mockResolvedValue(true);
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

describe("updateMemoCategoryAction", () => {
  it("소유자 스코프로 카테고리를 갱신한다", async () => {
    expect((await updateMemoCategoryAction("m1", "idea")).kind).toBe("ok");
    expect(setCategoryMock).toHaveBeenCalledWith("u1", "m1", "idea");
  });
  it("잘못된 slug 형식은 repo 호출 없이 invalid", async () => {
    expect((await updateMemoCategoryAction("m1", "한글")).kind).toBe("invalid");
    expect(setCategoryMock).not.toHaveBeenCalled();
  });
  it("소유 아님(false)이면 not-found", async () => {
    setCategoryMock.mockResolvedValue(false);
    expect((await updateMemoCategoryAction("m1", "idea")).kind).toBe("not-found");
  });
  it("repo 실패(FK 위반 포함)는 failed", async () => {
    setCategoryMock.mockRejectedValue(new Error("fk violation"));
    expect((await updateMemoCategoryAction("m1", "idea")).kind).toBe("failed");
  });
});
