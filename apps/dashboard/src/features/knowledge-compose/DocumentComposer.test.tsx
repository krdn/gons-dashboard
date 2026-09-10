// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./saveDocumentAction", () => ({ saveDocumentAction: save }));
import { DocumentComposer } from "./DocumentComposer";
afterEach(() => {
  cleanup();
  save.mockReset();
  sessionStorage.clear();
});
it("retains each template's draft when switching types", () => {
  render(<DocumentComposer initialTemplate="handoff" />);
  fireEvent.change(screen.getByLabelText("목표와 완료 조건"), {
    target: { value: "작업을 이어가기" },
  });
  fireEvent.click(screen.getByRole("button", { name: /기술 매뉴얼/ }));
  fireEvent.change(screen.getByLabelText("목적과 적용 범위"), {
    target: { value: "배포 방법" },
  });
  fireEvent.click(screen.getByRole("button", { name: /AI 인계/ }));
  expect(
    (screen.getByLabelText("목표와 완료 조건") as HTMLTextAreaElement).value,
  ).toBe("작업을 이어가기");
});
it("keeps input after failure and allows a successful retry", async () => {
  save
    .mockResolvedValueOnce({ kind: "failed" })
    .mockResolvedValueOnce({ kind: "ok", id: "saved-doc" });
  render(<DocumentComposer initialTemplate="handoff" />);
  fireEvent.change(screen.getByLabelText("문서 제목"), {
    target: { value: "배포 인계" },
  });
  fireEvent.change(screen.getByLabelText("목표와 완료 조건"), {
    target: { value: "배포 검증" },
  });
  fireEvent.click(screen.getByRole("button", { name: "보관함에 저장" }));
  await screen.findByText(/저장하지 못했습니다/);
  await screen.findByRole("button", { name: "보관함에 저장" });
  expect((screen.getByLabelText("문서 제목") as HTMLInputElement).value).toBe(
    "배포 인계",
  );
  fireEvent.click(screen.getByRole("button", { name: "보관함에 저장" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("link", { name: /저장한 문서 열기/ })
        .getAttribute("href"),
    ).toBe("/knowledge/saved-doc"),
  );
});

it("locks a saved document until starting a new draft and retries use one id", async () => {
  save
    .mockResolvedValueOnce({ kind: "failed" })
    .mockResolvedValueOnce({ kind: "ok", id: "doc" });
  render(<DocumentComposer initialTemplate="manual" />);
  fireEvent.change(screen.getByLabelText("문서 제목"), {
    target: { value: "운영 안내" },
  });
  fireEvent.change(screen.getByLabelText("목적과 적용 범위"), {
    target: { value: "배포 절차" },
  });
  fireEvent.click(screen.getByRole("button", { name: "보관함에 저장" }));
  await screen.findByText(/저장하지 못했습니다/);
  await screen.findByRole("button", { name: "보관함에 저장" });
  fireEvent.click(screen.getByRole("button", { name: "보관함에 저장" }));
  await screen.findByRole("button", { name: "새 문서 작성 +" });
  expect(save.mock.calls[0][0].requestId).toBe(save.mock.calls[1][0].requestId);
  expect(screen.getByLabelText("문서 제목").closest("fieldset")?.disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "새 문서 작성 +" }));
  expect((screen.getByLabelText("문서 제목") as HTMLInputElement).value).toBe(
    "",
  );
});

it("restores the tab draft including later fields without mixing accounts", () => {
  const first = render(
    <DocumentComposer userId="one" initialTemplate="handoff" />,
  );
  fireEvent.change(screen.getByLabelText("문서 제목"), {
    target: { value: "보관할 초안" },
  });
  fireEvent.change(screen.getByLabelText("주의사항 · 승인 필요한 작업"), {
    target: { value: "배포 전 확인" },
  });
  first.unmount();
  const second = render(
    <DocumentComposer userId="one" initialTemplate="handoff" />,
  );
  expect((screen.getByLabelText("문서 제목") as HTMLInputElement).value).toBe(
    "보관할 초안",
  );
  expect(
    (
      screen.getByLabelText(
        "주의사항 · 승인 필요한 작업",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("배포 전 확인");
  second.unmount();
  render(<DocumentComposer userId="two" initialTemplate="handoff" />);
  expect((screen.getByLabelText("문서 제목") as HTMLInputElement).value).toBe(
    "",
  );
});
it("shows an owned save conflict with an exact document link rather than an endless retry", async () => {
  save.mockResolvedValue({ kind: "conflict", id: "changed-id" });
  render(<DocumentComposer initialTemplate="manual" />);
  fireEvent.change(screen.getByLabelText("문서 제목"), {
    target: { value: "운영" },
  });
  fireEvent.change(screen.getByLabelText("목적과 적용 범위"), {
    target: { value: "배포" },
  });
  fireEvent.click(screen.getByRole("button", { name: "보관함에 저장" }));
  expect(
    (
      await screen.findByRole("link", { name: "기존에 저장된 문서 열기 →" })
    ).getAttribute("href"),
  ).toBe("/knowledge/changed-id");
  expect(
    (screen.getByRole("button", { name: "보관함에 저장" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
