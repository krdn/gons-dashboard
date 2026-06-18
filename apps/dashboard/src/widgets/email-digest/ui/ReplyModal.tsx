"use client";

// 답장 모달 컨테이너 — 오버레이·ESC 닫기·포커스 trap. 내용은 ReplyModalBody.
//
// confirmOpen 을 여기서 소유하는 이유:
//  - ESC 라우팅: 발송 확인이 열린 상태에서 ESC 는 모달 전체가 아니라 확인만 취소.
//  - focus trap 충돌 회피: 확인 다이얼로그가 열리면 부모 trap 을 suspend(+inert)해
//    포커스를 자식 다이얼로그에 양보. 한 번에 활성 trap 하나.
// dirty 가드는 자식(편집 상태를 아는 쪽)이 onRequestClose 안에서 판단.
import { useEffect, useId, useRef, useState } from "react";
import { ReplyModalBody } from "./ReplyModalBody";
import { useFocusTrap } from "../lib/useFocusTrap";

interface ReplyModalProps {
  threadId: string;
  subject: string;
  onClose: () => void;
  onSent: () => void;
}

export function ReplyModal({ threadId, subject, onClose, onSent }: ReplyModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 자식이 등록하는 "닫기 시도" 핸들러 — dirty면 자식이 confirm 게이트를 띄움.
  const requestCloseRef = useRef<() => void>(onClose);

  // 확인 다이얼로그가 열리면 부모 trap 을 양보(suspend).
  useFocusTrap(panelRef, { active: !confirmOpen });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // 확인 단계에서 ESC: 모달 전체가 아니라 확인만 취소.
      if (confirmOpen) {
        setConfirmOpen(false);
        return;
      }
      requestCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  function handleOverlayClick() {
    // 배경 클릭도 ESC 와 동일 가드.
    if (confirmOpen) {
      setConfirmOpen(false);
      return;
    }
    requestCloseRef.current();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh]"
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // 확인 다이얼로그가 위에 뜨면 배경 패널을 inert 처리(SR·키보드 격리).
        inert={confirmOpen ? true : undefined}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-elev)] focus:outline-none"
      >
        <p id={titleId} className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          답장 작성 — {subject || "(제목 없음)"}
        </p>
        <ReplyModalBody
          threadId={threadId}
          onClose={onClose}
          onSent={onSent}
          confirmOpen={confirmOpen}
          onConfirmOpenChange={setConfirmOpen}
          registerRequestClose={(fn) => {
            requestCloseRef.current = fn;
          }}
        />
      </div>
    </div>
  );
}
