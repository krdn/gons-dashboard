// @vitest-environment jsdom
// 스레딩 약화 배너 — generateReplyDraft 가 meta.threadingDegraded=true 면
// (원본 Message-ID 부재 → In-Reply-To/References 생략) 모달에 경고를 띄운다.
// 감사 §3 제안(b). meta 노출 + 조건부 렌더 회귀 가드.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const baseMeta = {
  toEmail: "a@b.com",
  subject: "제목",
  originalBody: "원문",
  inReplyTo: "",
  references: "",
  gmailThreadId: "g1",
};

// 각 테스트가 threadingDegraded 값을 바꿀 수 있게 mutable.
let degraded = false;

vi.mock("@/features/email-reply/client", () => ({
  generateReplyDraft: vi.fn(async () => ({
    kind: "ok",
    drafts: [{ tone: "polite", body: "정중 초안", refusal: false }],
    meta: { ...baseMeta, threadingDegraded: degraded },
  })),
  saveReplyDraft: vi.fn(),
  sendReply: vi.fn(),
}));

import { ReplyModalBody } from "@/widgets/email-digest/ui/ReplyModalBody";

afterEach(cleanup);
function noop() {}

function renderModal() {
  return render(
    <ReplyModalBody
      threadId="t1"
      onClose={noop}
      onSent={noop}
      confirmOpen={false}
      onConfirmOpenChange={noop}
      registerRequestClose={noop}
    />,
  );
}

describe("스레딩 약화 배너", () => {
  it("threadingDegraded=true → 경고 배너 렌더 (role=status)", async () => {
    degraded = true;
    const { container } = renderModal();

    await waitFor(() => {
      expect(container.querySelector("textarea")).not.toBeNull();
    });

    const statuses = Array.from(container.querySelectorAll('[role="status"]'));
    const banner = statuses.find((el) =>
      el.textContent?.includes("새 메일로"),
    );
    expect(banner).toBeDefined();
  });

  it("threadingDegraded=false → 배너 없음", async () => {
    degraded = false;
    const { container } = renderModal();

    await waitFor(() => {
      expect(container.querySelector("textarea")).not.toBeNull();
    });

    const hasBanner = Array.from(
      container.querySelectorAll('[role="status"]'),
    ).some((el) => el.textContent?.includes("새 메일로"));
    expect(hasBanner).toBe(false);
  });
});
