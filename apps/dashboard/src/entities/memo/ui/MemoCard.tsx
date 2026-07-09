"use client";
import { useState } from "react";
import type { Memo } from "../model/types";

interface MemoCardProps {
  memo: Memo;
  onEdit?: (memo: Memo) => void;
  onDelete?: (id: string) => void;
}

// locale-free 시각 포맷 (hydration mismatch 방지 — Gotcha #3).
function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MemoCard({ memo, onEdit, onDelete }: MemoCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const isVoice = memo.source === "voice";
  const body = showRaw ? memo.rawContent : memo.cleanedContent;

  return (
    <article className="rounded-lg border border-neutral-200 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-900">{memo.title}</h3>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500">
          {isVoice ? "🎙 음성" : "✍ 텍스트"}
        </span>
      </header>
      <p className="whitespace-pre-wrap text-sm text-neutral-700">{body}</p>
      <footer className="mt-3 flex items-center gap-3 text-xs text-neutral-400">
        <time>{formatTime(memo.createdAt)}</time>
        {isVoice && (
          <button type="button" onClick={() => setShowRaw((v) => !v)} className="hover:text-neutral-700">
            {showRaw ? "정리본 보기" : "원문 보기"}
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={() => onEdit(memo)} className="hover:text-neutral-700">
            편집
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={() => onDelete(memo.id)} className="hover:text-red-600">
            삭제
          </button>
        )}
      </footer>
    </article>
  );
}
