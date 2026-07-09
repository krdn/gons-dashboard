import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const getMemoMock = vi.fn();
const upsertMock = vi.fn();
const transformMock = vi.fn();
const resolvePresetMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }));
vi.mock("@/entities/memo/server", () => ({
  getMemo: (...a: unknown[]) => getMemoMock(...a),
  upsertTransformation: (...a: unknown[]) => upsertMock(...a),
}));
vi.mock("../lib/transform-memo", () => ({
  transformMemoContent: (...a: unknown[]) => transformMock(...a),
  TRANSFORM_MODEL: "claude-sonnet-5",
}));
vi.mock("../lib/preset-resolver", () => ({
  resolvePreset: (...a: unknown[]) => resolvePresetMock(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { transformMemoAction } from "./transformMemoAction";
import { saveTransformationAction } from "./saveTransformationAction";

const memo = { id: "m1", cleanedContent: "가".repeat(200) };
const resolvedSummary = {
  slug: "summary",
  label: "정돈",
  instruction: "스타일: 요약.",
  fidelityGuard: true,
  minInputLen: 80,
  strictPreserve: false,
  isBuiltin: true,
  isOverridden: false,
};

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  getMemoMock.mockReset().mockResolvedValue(memo);
  upsertMock.mockReset().mockResolvedValue({ id: "t1" });
  transformMock.mockReset().mockResolvedValue({ kind: "ok", content: "결과" });
  resolvePresetMock.mockReset().mockResolvedValue(resolvedSummary);
});

describe("transformMemoAction", () => {
  it("미인증 세션은 Unauthorized로 거부한다", async () => {
    authMock.mockResolvedValue(null);
    await expect(transformMemoAction("m1", "summary")).rejects.toThrow("Unauthorized");
    expect(getMemoMock).not.toHaveBeenCalled();
  });
  it("알 수 없는 preset은 invalid (resolvePreset null → 경계 검증)", async () => {
    resolvePresetMock.mockResolvedValue(null);
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
  it("변환 결과를 그대로 반환하고 truncated는 false (4000자 이하)", async () => {
    expect(await transformMemoAction("m1", "summary")).toEqual({
      kind: "ok",
      content: "결과",
      truncated: false,
    });
    // 소유 검증이 세션 userId로 이뤄지는지 인자까지 단언 (userId 누락 회귀 가드).
    expect(getMemoMock).toHaveBeenCalledWith("u1", "m1");
    expect(resolvePresetMock).toHaveBeenCalledWith("u1", "summary");
    expect(transformMock).toHaveBeenCalledWith(memo.cleanedContent, resolvedSummary);
  });
  it("입력이 4000자 초과면 truncated: true", async () => {
    getMemoMock.mockResolvedValue({ id: "m1", cleanedContent: "가".repeat(4_001) });
    expect(await transformMemoAction("m1", "summary")).toEqual({
      kind: "ok",
      content: "결과",
      truncated: true,
    });
  });
});

describe("saveTransformationAction", () => {
  it("미인증 세션은 Unauthorized로 거부한다", async () => {
    authMock.mockResolvedValue(null);
    await expect(saveTransformationAction("m1", "summary", "내용")).rejects.toThrow("Unauthorized");
    expect(upsertMock).not.toHaveBeenCalled();
  });
  it("알 수 없는 preset은 invalid (resolvePreset null)", async () => {
    resolvePresetMock.mockResolvedValue(null);
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("invalid");
    expect(upsertMock).not.toHaveBeenCalled();
  });
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
  it("upsert 성공 시 ok + revalidatePath (presetLabel은 resolved.label)", async () => {
    const { revalidatePath } = await import("next/cache");
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("ok");
    expect(upsertMock).toHaveBeenCalledWith({
      memoId: "m1",
      preset: "summary",
      presetLabel: "정돈",
      model: "claude-sonnet-5",
      content: "내용",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/memos");
  });
  it("DB 실패는 failed로 삼킨다", async () => {
    upsertMock.mockRejectedValue(new Error("db down"));
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("failed");
  });
  it("삭제된(커스텀) 프리셋 저장 시도는 invalid", async () => {
    resolvePresetMock.mockResolvedValue(null);
    expect((await saveTransformationAction("m1", "deleted-custom", "내용")).kind).toBe("invalid");
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
