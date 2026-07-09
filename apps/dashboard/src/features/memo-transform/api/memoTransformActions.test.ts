import { describe, it, expect, vi, beforeEach } from "vitest";

const getMemoMock = vi.fn();
const upsertMock = vi.fn();
const transformMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  getMemo: (...a: unknown[]) => getMemoMock(...a),
  upsertTransformation: (...a: unknown[]) => upsertMock(...a),
}));
vi.mock("../lib/transform-memo", () => ({
  transformMemoContent: (...a: unknown[]) => transformMock(...a),
  TRANSFORM_MODEL: "claude-sonnet-5",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { transformMemoAction } from "./transformMemoAction";
import { saveTransformationAction } from "./saveTransformationAction";

const memo = { id: "m1", cleanedContent: "가".repeat(200) };

beforeEach(() => {
  getMemoMock.mockReset().mockResolvedValue(memo);
  upsertMock.mockReset().mockResolvedValue({ id: "t1" });
  transformMock.mockReset().mockResolvedValue({ kind: "ok", content: "결과" });
});

describe("transformMemoAction", () => {
  it("알 수 없는 preset은 invalid (경계 검증)", async () => {
    expect((await transformMemoAction("m1", "nope")).kind).toBe("invalid");
    expect(getMemoMock).not.toHaveBeenCalled();
  });
  it("소유 아님(getMemo null)이면 not-found", async () => {
    getMemoMock.mockResolvedValue(null);
    expect((await transformMemoAction("m1", "summary")).kind).toBe("not-found");
  });
  it("minInputLen 미달이면 too-short (서버 재검증)", async () => {
    getMemoMock.mockResolvedValue({ id: "m1", cleanedContent: "짧다" });
    expect((await transformMemoAction("m1", "summary")).kind).toBe("too-short");
    expect(transformMock).not.toHaveBeenCalled();
  });
  it("변환 결과를 그대로 반환한다", async () => {
    expect(await transformMemoAction("m1", "summary")).toEqual({ kind: "ok", content: "결과" });
    expect(transformMock).toHaveBeenCalledWith(memo.cleanedContent, "summary");
  });
});

describe("saveTransformationAction", () => {
  it("빈 content는 invalid", async () => {
    expect((await saveTransformationAction("m1", "summary", "  ")).kind).toBe("invalid");
    expect(upsertMock).not.toHaveBeenCalled();
  });
  it("20k 초과는 invalid", async () => {
    expect((await saveTransformationAction("m1", "summary", "가".repeat(20_001))).kind).toBe("invalid");
  });
  it("소유 아님이면 not-found", async () => {
    getMemoMock.mockResolvedValue(null);
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("not-found");
  });
  it("upsert 성공 시 ok + revalidatePath", async () => {
    const { revalidatePath } = await import("next/cache");
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("ok");
    expect(upsertMock).toHaveBeenCalledWith({
      memoId: "m1",
      preset: "summary",
      model: "claude-sonnet-5",
      content: "내용",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/memos");
  });
  it("DB 실패는 failed로 삼킨다", async () => {
    upsertMock.mockRejectedValue(new Error("db down"));
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("failed");
  });
});
