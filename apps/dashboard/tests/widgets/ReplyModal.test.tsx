// @vitest-environment jsdom
// ReplyModal ESC/배경클릭 라우팅 — confirmOpen 가드. ReplyModalBody는 stub.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

// ReplyModalBody를 stub — confirmOpen/onConfirmOpenChange/registerRequestClose만
// 노출하는 가벼운 더미로 대체해 ESC/오버레이 라우팅만 격리 검증.
vi.mock("@/widgets/email-digest/ui/ReplyModalBody", () => ({
  ReplyModalBody: ({
    confirmOpen,
    onConfirmOpenChange,
    registerRequestClose,
    onClose,
  }: {
    confirmOpen: boolean;
    onConfirmOpenChange: (v: boolean) => void;
    registerRequestClose: (fn: () => void) => void;
    onClose: () => void;
  }) => {
    // 부모가 호출할 닫기 핸들러 등록 — 여기선 dirty 없이 바로 onClose.
    registerRequestClose(onClose);
    return (
      <div>
        <span data-testid="confirm-state">{String(confirmOpen)}</span>
        <button data-testid="open-confirm" onClick={() => onConfirmOpenChange(true)}>
          open
        </button>
      </div>
    );
  },
}));

import { ReplyModal } from "@/widgets/email-digest/ui/ReplyModal";

afterEach(cleanup);

function setup() {
  const onClose = vi.fn();
  const onSent = vi.fn();
  const utils = render(
    <ReplyModal threadId="t1" subject="제목" onClose={onClose} onSent={onSent} />,
  );
  return { onClose, onSent, ...utils };
}

describe("ReplyModal ESC/오버레이 라우팅", () => {
  it("확인 닫힘 상태에서 ESC → 모달 닫기(onClose)", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("확인 열림 상태에서 ESC → 확인만 취소, 모달 유지", () => {
    const { onClose, getByTestId } = setup();
    fireEvent.click(getByTestId("open-confirm"));
    expect(getByTestId("confirm-state").textContent).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    // 확인이 닫히고 모달은 유지 — onClose 미호출.
    expect(getByTestId("confirm-state").textContent).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("확인 열림 상태에서 배경 클릭 → 확인만 취소, 모달 유지", () => {
    const { onClose, getByTestId, container } = setup();
    fireEvent.click(getByTestId("open-confirm"));

    // 오버레이(최상위 div) 클릭.
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(getByTestId("confirm-state").textContent).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("확인 열림 시 배경 패널이 inert", () => {
    const { getByTestId, container } = setup();
    const panel = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel.hasAttribute("inert")).toBe(false);
    fireEvent.click(getByTestId("open-confirm"));
    expect(panel.hasAttribute("inert")).toBe(true);
  });
});
