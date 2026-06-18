// @vitest-environment jsdom
// SendConfirmDialog portal 회귀 — 다이얼로그가 inert 패널 자손이 아니라
// document.body 직속에 렌더되는지. (inert 동작 자체는 jsdom 미구현이라
// DOM 트리 위치로 회귀를 잡는다 — portal 제거 시 즉시 실패.)
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { SendConfirmDialog } from "@/widgets/email-digest/ui/SendConfirmDialog";

afterEach(cleanup);

describe("SendConfirmDialog portal", () => {
  it("다이얼로그가 inert 컨테이너 밖(document.body)에 렌더", () => {
    const { container } = render(
      // 부모를 inert 로 표기 — portal 이 없으면 다이얼로그가 이 안에 갇힘.
      <div inert data-testid="inert-parent">
        <SendConfirmDialog
          toEmail="a@b.com"
          subject="제목"
          body="본문"
          cc=""
          bcc=""
          isSending={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </div>,
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // 다이얼로그가 inert 부모의 자손이면 안 됨(portal 로 탈출).
    const inertParent = container.querySelector('[data-testid="inert-parent"]');
    expect(inertParent?.contains(dialog!)).toBe(false);
  });

  it("CC/BCC 값 있으면 표시, 빈 값이면 숨김", () => {
    render(
      <SendConfirmDialog
        toEmail="a@b.com"
        subject="제목"
        body="본문"
        cc="c@b.com"
        bcc=""
        isSending={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.body.textContent).toContain("참조:");
    expect(document.body.textContent).not.toContain("숨은참조:");
  });

  it("취소 클릭 → onCancel", () => {
    const onCancel = vi.fn();
    render(
      <SendConfirmDialog
        toEmail="a@b.com"
        subject="제목"
        body="본문"
        cc=""
        bcc=""
        isSending={false}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    const cancelBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "취소",
    );
    fireEvent.click(cancelBtn!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
