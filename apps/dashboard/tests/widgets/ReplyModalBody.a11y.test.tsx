// @vitest-environment jsdom
// ReplyModalBody 톤 탭 a11y 구조 회귀 — tabpanel 은 textarea 를 감싸는
// 컨테이너여야 한다. textarea 에 role=tabpanel 을 직접 주면 textbox 시맨틱이
// 덮여 SR 이 편집 필드로 못 읽음(PR #162 머지 누락으로 회귀했던 버그).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/features/email-reply/client", () => ({
  generateReplyDraft: vi.fn(async () => ({
    kind: "ok",
    drafts: [
      { tone: "polite", body: "정중 초안", refusal: false },
      { tone: "concise", body: "간결 초안", refusal: false },
    ],
    meta: {
      toEmail: "a@b.com",
      subject: "제목",
      originalBody: "원문",
      inReplyTo: "",
      references: "",
      gmailThreadId: "g1",
    },
  })),
  saveReplyDraft: vi.fn(),
  sendReply: vi.fn(),
}));

import { ReplyModalBody } from "@/widgets/email-digest/ui/ReplyModalBody";

afterEach(cleanup);

function noop() {}

describe("ReplyModalBody tabpanel a11y 구조", () => {
  it("textarea 는 textbox role 을 유지(tabpanel 은 별도 컨테이너)", async () => {
    const { container } = render(
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
    const textarea = await waitFor(() => {
      const ta = container.querySelector("textarea");
      expect(ta).not.toBeNull();
      return ta!;
    });

    // textarea 에 role 이 없어야(implicit textbox 유지).
    expect(textarea.getAttribute("role")).toBeNull();
    // tabpanel 은 textarea 가 아닌 별도 요소.
    const tabpanel = container.querySelector('[role="tabpanel"]');
    expect(tabpanel).not.toBeNull();
    expect(tabpanel!.tagName).not.toBe("TEXTAREA");
    // tabpanel 이 textarea 를 감싸야.
    expect(tabpanel!.contains(textarea)).toBe(true);
    // textarea 는 aria-label 로 접근 가능 이름을 가져야.
    expect(textarea.getAttribute("aria-label")).toContain("답장 본문");
  });

  it("활성 tab 이 aria-controls 로 tabpanel 을 가리킴", async () => {
    const { container } = render(
      <ReplyModalBody
        threadId="t1"
        onClose={noop}
        onSent={noop}
        confirmOpen={false}
        onConfirmOpenChange={noop}
        registerRequestClose={noop}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[role="tab"]')).not.toBeNull();
    });
    const selectedTab = container.querySelector('[role="tab"][aria-selected="true"]');
    const panel = container.querySelector('[role="tabpanel"]');
    expect(selectedTab!.getAttribute("aria-controls")).toBe(panel!.id);
  });
});
