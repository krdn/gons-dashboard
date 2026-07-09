"use client";
import { useState } from "react";
import type { Memo, MemoTransformation, TransformPresetId } from "../model/types";
import { TRANSFORM_PRESET_IDS, TRANSFORM_PRESET_LABELS } from "../model/types";

interface MemoCardProps {
  memo: Memo;
  /** 이 메모의 저장된 변환본들 — 칩으로 전환 표시. */
  transformations?: MemoTransformation[];
  onEdit?: (memo: Memo) => void;
  onDelete?: (id: string) => void;
  /** AI 정리 다이얼로그 트리거 (조립은 MemoList 담당 — entity는 features 접근 불가). */
  onTransform?: (memo: Memo) => void;
}

// 표시 뷰: 정리본 | 원문 | 저장된 변환본(프리셋 id).
type MemoView = "cleaned" | "raw" | TransformPresetId;

// locale-free 시각 포맷 (hydration mismatch 방지 — Gotcha #3).
function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MemoCard({ memo, transformations = [], onEdit, onDelete, onTransform }: MemoCardProps) {
  const [view, setView] = useState<MemoView>("cleaned");
  const isVoice = memo.source === "voice";

  const active = transformations.find((t) => t.preset === view);
  const body =
    view === "cleaned" ? memo.cleanedContent : view === "raw" ? memo.rawContent : (active?.content ?? memo.cleanedContent);

  // DB 조회는 순서를 보장하지 않으므로(ORDER BY 없음) 칩은 프리셋 고정 순서로 정렬 —
  // 재생성·재방문해도 같은 프리셋이 항상 같은 위치에 온다.
  const sortedTransformations = [...transformations].sort(
    (a, b) =>
      (TRANSFORM_PRESET_IDS as readonly string[]).indexOf(a.preset) -
      (TRANSFORM_PRESET_IDS as readonly string[]).indexOf(b.preset),
  );
  const chips: Array<{ key: MemoView; label: string }> = [
    { key: "cleaned", label: "정리본" },
    ...(isVoice ? [{ key: "raw" as MemoView, label: "원문" }] : []),
    ...sortedTransformations.map((t) => ({
      key: t.preset as TransformPresetId,
      label: TRANSFORM_PRESET_LABELS[t.preset as TransformPresetId] ?? t.preset,
    })),
  ];

  return (
    <article className="rounded-lg border border-neutral-200 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-900">{memo.title}</h3>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500">
          {isVoice ? "🎙 음성" : "✍ 텍스트"}
        </span>
      </header>
      {chips.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setView(c.key)}
              className={
                view === c.key
                  ? "rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs text-white"
                  : "rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-500 hover:text-neutral-900"
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm text-neutral-700">{body}</p>
      <footer className="mt-3 flex items-center gap-3 text-xs text-neutral-400">
        <time>{formatTime(memo.createdAt)}</time>
        {onTransform && (
          <button type="button" onClick={() => onTransform(memo)} className="hover:text-neutral-700">
            AI 정리
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
