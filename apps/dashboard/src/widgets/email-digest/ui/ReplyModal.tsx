"use client";

// 답장 모달 컨테이너 — 오버레이·ESC 닫기·포커스. 내용은 ReplyModalBody.
import { useEffect, useId, useRef } from "react";
import { ReplyModalBody } from "./ReplyModalBody";

interface ReplyModalProps {
  threadId: string;
  subject: string;
  onClose: () => void;
  onSent: () => void;
}

export function ReplyModal({ threadId, subject, onClose, onSent }: ReplyModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-elev)] focus:outline-none"
      >
        <p id={titleId} className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          답장 작성 — {subject || "(제목 없음)"}
        </p>
        <ReplyModalBody threadId={threadId} onClose={onClose} onSent={onSent} />
      </div>
    </div>
  );
}
