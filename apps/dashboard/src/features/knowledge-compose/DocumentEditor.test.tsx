// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/features/memo-manage/client", () => ({ updateMemoAction: update }));
import { DocumentEditor } from "./DocumentEditor";
afterEach(() => {
  cleanup();
  update.mockReset();
});
it("edits the exact document id and retains text on failure", async () => {
  update
    .mockResolvedValueOnce({ kind: "failed" })
    .mockResolvedValueOnce({ kind: "ok" });
  render(
    <DocumentEditor id="exact-id" title="같은 제목" content="원래 내용" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "문서 수정" }));
  fireEvent.change(screen.getByLabelText("본문 (Markdown)"), {
    target: { value: "변경 내용" },
  });
  fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
  await screen.findByText(/수정하지 못했습니다/);
  await screen.findByRole("button", { name: "변경 저장" });
  expect(
    (screen.getByLabelText("본문 (Markdown)") as HTMLTextAreaElement).value,
  ).toBe("변경 내용");
  fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
  expect(update).toHaveBeenLastCalledWith("exact-id", {
    title: "같은 제목",
    cleanedContent: "변경 내용",
    expected: { title: "같은 제목", cleanedContent: "원래 내용" },
  });
});
