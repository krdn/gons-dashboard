"use client";

// 발송 2단계 확인 — 받는사람·제목·본문 미리보기 후 최종 발송.
// 외부로 나가는 비가역 액션이라 명시적 확인 게이트 (spec §4.3).
// ESC 라우팅은 부모(ReplyModal)가 confirmOpen 가드로 처리. 여기선 focus trap만
// (부모 패널이 inert 로 격리된 동안 포커스를 이 다이얼로그 안에 가둠).
//
// ⚠️ createPortal 로 document.body 에 렌더하는 이유: 호출부가 ReplyModal 의
// inert 패널 DOM 자손이라, portal 없이 그대로 두면 inert 가 이 다이얼로그까지
// 비활성화해 발송/취소 버튼이 클릭·포커스 불가가 된다(inert 는 DOM 조상 기준).
// state·핸들러는 ReplyModalBody 에 남고 DOM 노드만 body 로 탈출.
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../lib/useFocusTrap";

interface SendConfirmDialogProps {
  toEmail: string;
  subject: string;
  body: string;
  // cc/bcc는 호출부 useState("") — 항상 정의된 string. required로 두어
  // 호출부 전달 누락을 컴파일 에러로 강제(wiring 갭 방지). 빈 값은 줄 숨김.
  cc: string;
  bcc: string;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SendConfirmDialog({
  toEmail,
  subject,
  body,
  cc,
  bcc,
  isSending,
  onConfirm,
  onCancel,
}: SendConfirmDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // 부모 패널이 inert 인 동안 포커스를 이 다이얼로그 안에 가둠 + 닫힐 때 복원.
  useFocusTrap(panelRef);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-elev)] focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <p id={titleId} className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          이 답장을 발송할까요?
        </p>
        <dl className="mb-3 space-y-1 text-xs text-[var(--color-text-muted)]">
          <div>
            받는사람: <b className="text-[var(--color-text)]">{toEmail}</b>
          </div>
          {cc && (
            <div>
              참조: <b className="text-[var(--color-text)]">{cc}</b>
            </div>
          )}
          {bcc && (
            // BCC는 숨은 수신자 — 오발송 방지 위해 경고색으로 강조.
            <div className="text-[var(--color-warn)]">
              숨은참조: <b>{bcc}</b>
            </div>
          )}
          <div>제목: {subject}</div>
        </dl>
        <div className="mb-4 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text)]">
          {body}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSending}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSending}
            className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:opacity-80 disabled:opacity-40"
          >
            {isSending ? "발송 중…" : "보내기"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
