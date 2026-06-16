"use client";

// 발송 2단계 확인 — 받는사람·제목·본문 미리보기 후 최종 발송.
// 외부로 나가는 비가역 액션이라 명시적 확인 게이트 (spec §4.3).
import { useId } from "react";

interface SendConfirmDialogProps {
  toEmail: string;
  subject: string;
  body: string;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SendConfirmDialog({
  toEmail,
  subject,
  body,
  isSending,
  onConfirm,
  onCancel,
}: SendConfirmDialogProps) {
  const titleId = useId();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-elev)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p id={titleId} className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          이 답장을 발송할까요?
        </p>
        <dl className="mb-3 space-y-1 text-xs text-[var(--color-text-muted)]">
          <div>
            받는사람: <b className="text-[var(--color-text)]">{toEmail}</b>
          </div>
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
    </div>
  );
}
