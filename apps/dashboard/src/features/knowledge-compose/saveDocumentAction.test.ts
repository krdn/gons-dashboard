import { beforeEach, expect, it, vi } from "vitest";
const { auth, createMemoOnce, getMemo, revalidatePath } = vi.hoisted(() => ({
  auth: vi.fn(),
  createMemoOnce: vi.fn(),
  getMemo: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/auth", () => ({ auth }));
vi.mock("@/entities/memo/server", () => ({ createMemoOnce, getMemo }));
vi.mock("next/cache", () => ({ revalidatePath }));
const requestId = "00000000-0000-4000-8000-000000000001";
import { saveDocumentAction } from "./saveDocumentAction";
beforeEach(() => {
  vi.clearAllMocks();
  getMemo.mockResolvedValue(null);
  auth.mockResolvedValue({ user: { id: "owner" } });
  createMemoOnce.mockResolvedValue({ id: "doc" });
});
it("requires an authenticated owner before writing", async () => {
  auth.mockResolvedValue(null);
  expect(
    await saveDocumentAction({
      kind: "manual",
      requestId,
      title: "a",
      content: "b",
    }),
  ).toEqual({
    kind: "unauthorized",
  });
  expect(createMemoOnce).not.toHaveBeenCalled();
});
it("validates input at the server boundary", async () => {
  for (const input of [
    { title: " ", content: "body" },
    { title: "title", content: "x".repeat(20001) },
    { title: "x".repeat(161), content: "body" },
    { title: "ok", content: "" },
  ])
    expect(
      await saveDocumentAction({ kind: "manual", ...input, requestId }),
    ).toEqual({
      kind: "invalid",
    });
  expect(createMemoOnce).not.toHaveBeenCalled();
});
it("preserves original content under session ownership", async () => {
  expect(
    await saveDocumentAction({
      kind: "manual",
      requestId,
      title: "Manual",
      content: "## Step\n\nVerified",
    }),
  ).toEqual({ kind: "ok", id: "doc" });
  expect(createMemoOnce).toHaveBeenCalledWith(
    {
      userId: "owner",
      source: "text",
      title: "Manual",
      rawContent: "## Step\n\nVerified",
      cleanedContent: "## Step\n\nVerified",
    },
    requestId,
    { id: "workspace-manual", labelKo: "기술 매뉴얼" },
  );
  expect(revalidatePath).toHaveBeenCalledWith("/knowledge");
});
it("reports a failed write without leaking database details", async () => {
  createMemoOnce.mockRejectedValue(new Error("private db details"));
  expect(
    await saveDocumentAction({
      kind: "manual",
      requestId,
      title: "a",
      content: "b",
    }),
  ).toEqual({
    kind: "failed",
  });
});

it("rejects malformed request identifiers before persistence", async () => {
  expect(
    await saveDocumentAction({
      kind: "manual",
      requestId: "invalid",
      title: "ok",
      content: "body",
    }),
  ).toEqual({ kind: "invalid" });
  expect(createMemoOnce).not.toHaveBeenCalled();
});
it("does not report a conflicting id as a saved document", async () => {
  createMemoOnce.mockResolvedValue(null);
  expect(
    await saveDocumentAction({
      kind: "manual",
      requestId,
      title: "ok",
      content: "body",
    }),
  ).toEqual({ kind: "failed" });
});

it("distinguishes an owned modified document from a retryable write error", async () => {
  createMemoOnce.mockResolvedValue(null);
  getMemo.mockResolvedValue({ id: requestId });
  expect(
    await saveDocumentAction({
      requestId,
      kind: "manual",
      title: "ok",
      content: "body",
    }),
  ).toEqual({ kind: "conflict", id: requestId });
  expect(getMemo).toHaveBeenCalledWith("owner", requestId);
});
