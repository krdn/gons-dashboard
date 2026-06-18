// @vitest-environment jsdom
// invalid-recipient UI 경로 — 서버가 형식 오류를 반환하면 editing 화면 유지하며
// 인라인 alert 표시(본문 보존). 새 failure kind 의 UI 플러밍 회귀 가드.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";

const okMeta = {
  toEmail: "a@b.com",
  subject: "제목",
  originalBody: "원문",
  inReplyTo: "",
  references: "",
  gmailThreadId: "g1",
};

const saveReplyDraft = vi.fn(async (..._args: unknown[]) => ({
  kind: "invalid-recipient",
  field: "cc",
}));

vi.mock("@/features/email-reply/client", () => ({
  generateReplyDraft: vi.fn(async () => ({
    kind: "ok",
    drafts: [{ tone: "polite", body: "정중 초안", refusal: false }],
    meta: okMeta,
  })),
  saveReplyDraft: (...args: unknown[]) => saveReplyDraft(...args),
  sendReply: vi.fn(),
}));

import { ReplyModalBody } from "@/widgets/email-digest/ui/ReplyModalBody";

afterEach(cleanup);
function noop() {}

describe("invalid-recipient UI 경로", () => {
  it("형식 오류 반환 → 인라인 alert + editing 유지(본문 보존)", async () => {
    const { container, getByText } = render(
      <ReplyModalBody
        threadId="t1"
        onClose={noop}
        onSent={noop}
        confirmOpen={false}
        onConfirmOpenChange={noop}
        registerRequestClose={noop}
      />,
    );

    // editing phase 진입 대기.
    await waitFor(() => {
      expect(container.querySelector("textarea")).not.toBeNull();
    });

    // 'Gmail 초안 저장' 클릭.
    const saveBtn = getByText("Gmail 초안 저장");
    fireEvent.click(saveBtn);

    // 인라인 alert 에 'CC' 필드 안내 + editing 유지(textarea 존재 = 본문 보존).
    await waitFor(() => {
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.textContent).toContain("참조 (CC)");
    });
    // error phase(다시 시도 버튼)로 안 빠지고 editing 유지.
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
