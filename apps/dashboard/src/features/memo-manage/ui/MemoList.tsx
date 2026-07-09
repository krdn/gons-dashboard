"use client";
import { useState } from "react";
import { MemoCard, type Memo } from "@/entities/memo/client";
import { updateMemoAction, deleteMemoAction } from "../client";

interface MemoListProps {
  memos: Memo[];
}

export function MemoList({ memos }: MemoListProps) {
  const [editing, setEditing] = useState<Memo | null>(null);
  const [draft, setDraft] = useState({ title: "", cleaned: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function startEdit(memo: Memo) {
    setEditing(memo);
    setDraft({ title: memo.title, cleaned: memo.cleanedContent });
  }

  function saveEdit() {
    if (!editing) return;
    setBusy(true);
    updateMemoAction(editing.id, { title: draft.title, cleanedContent: draft.cleaned }).then(
      (r) => {
        setBusy(false);
        if (r.kind === "ok") {
          setEditing(null);
          setNotice(null);
        } else if (r.kind === "invalid") {
          setNotice("내용이 비어 있습니다.");
        } else if (r.kind === "not-found") {
          setNotice("메모를 찾을 수 없습니다.");
        } else {
          setNotice("수정에 실패했습니다.");
        }
      },
      () => {
        setBusy(false);
        setNotice("수정에 실패했습니다.");
      },
    );
  }

  function handleDelete(id: string) {
    setBusy(true);
    deleteMemoAction(id).then(
      (r) => {
        setBusy(false);
        if (r.kind === "ok") {
          setNotice(null);
        } else if (r.kind === "not-found") {
          setNotice("메모를 찾을 수 없습니다.");
        } else {
          setNotice("삭제에 실패했습니다.");
        }
      },
      () => {
        setBusy(false);
        setNotice("삭제에 실패했습니다.");
      },
    );
  }

  if (memos.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-400">아직 메모가 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {notice && <p className="text-sm text-neutral-500">{notice}</p>}
      {memos.map((memo) =>
        editing?.id === memo.id ? (
          <div key={memo.id} className="space-y-2 rounded-lg border border-neutral-300 p-4">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <textarea
              value={draft.cleaned}
              onChange={(e) => setDraft((d) => ({ ...d, cleaned: e.target.value }))}
              rows={5}
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
                className="rounded border px-3 py-1.5 text-sm"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <MemoCard key={memo.id} memo={memo} onEdit={startEdit} onDelete={handleDelete} />
        ),
      )}
    </div>
  );
}
