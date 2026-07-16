"use client";
import { useState } from "react";
import { MemoCard, type Memo, type MemoActionItem, type MemoTransformation } from "@/entities/memo/client";
import { updateMemoAction, deleteMemoAction, updateMemoCategoryAction } from "../client";
// features→features 허용 예외 (memo-manage가 변환 다이얼로그·액션 패널을 조립).
import { TransformDialog } from "@/features/memo-transform/ui/TransformDialog";
import type { TransformPresetOption } from "@/features/memo-transform/client";
import { MemoActionPanel } from "@/features/memo-actions/ui/MemoActionPanel";

interface MemoListProps {
  memos: Memo[];
  transformationsByMemo: Record<string, MemoTransformation[]>;
  presets: TransformPresetOption[];
  /** 메모별 액션 제안·할일 (proposed·accepted) — 없으면 패널 미렌더. */
  actionItemsByMemo?: Record<string, MemoActionItem[]>;
  /** 검색어 하이라이트 — 검색 결과 렌더 시에만 전달. */
  highlightTerms?: string[];
  /** 편집·삭제 성공 후 콜백 — 검색 모드의 클라이언트 결과를 재검색으로 갱신 (revalidatePath가 못 미침). */
  onMutated?: () => void;
  /** 등록된 카테고리 목록 — 배지 라벨 조회 (DB memo_categories, 서버 로드). */
  categories: { id: string; labelKo: string }[];
}

export function MemoList({
  memos,
  transformationsByMemo,
  presets,
  actionItemsByMemo,
  highlightTerms,
  onMutated,
  categories,
}: MemoListProps) {
  const categoryLabels: Record<string, string> = Object.fromEntries(
    categories.map((c) => [c.id, c.labelKo]),
  );
  const [editing, setEditing] = useState<Memo | null>(null);
  const [transforming, setTransforming] = useState<Memo | null>(null);
  const [draft, setDraft] = useState({ title: "", cleaned: "" });
  const [busy, setBusy] = useState(false);
  // 카테고리 변경 진행 중인 메모 id — 병렬 UPDATE는 완료 순서가 비보장이라
  // 마지막 선택이 DB에 남는다는 보장이 없다. 완료 전 중복 제출을 차단.
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);
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
          onMutated?.();
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

  // LLM 오분류 수동 정정 — 성공 시 revalidatePath(idle) 또는 onMutated(검색 모드)가 목록을 갱신.
  function handleChangeCategory(memoId: string, category: string) {
    if (categoryBusyId !== null) return;
    setCategoryBusyId(memoId);
    updateMemoCategoryAction(memoId, category).then(
      (r) => {
        setCategoryBusyId(null);
        if (r.kind === "ok") {
          setNotice(null);
          onMutated?.();
        } else if (r.kind === "not-found") {
          setNotice("메모를 찾을 수 없습니다.");
        } else {
          setNotice("카테고리 변경에 실패했습니다.");
        }
      },
      () => {
        setCategoryBusyId(null);
        setNotice("카테고리 변경에 실패했습니다.");
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
          onMutated?.();
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
          <MemoCard
            key={memo.id}
            memo={memo}
            transformations={transformationsByMemo[memo.id] ?? []}
            onEdit={startEdit}
            onDelete={handleDelete}
            onTransform={setTransforming}
            highlightTerms={highlightTerms}
            categoryLabels={categoryLabels}
            onChangeCategory={handleChangeCategory}
            categoryOptions={categories}
            categoryUpdating={categoryBusyId === memo.id}
            actionsSlot={
              (actionItemsByMemo?.[memo.id]?.length ?? 0) > 0 ? (
                <MemoActionPanel items={actionItemsByMemo?.[memo.id] ?? []} />
              ) : undefined
            }
          />
        ),
      )}
      {transforming && (
        <TransformDialog
          memo={transforming}
          presets={presets}
          existingPresets={(transformationsByMemo[transforming.id] ?? []).map((t) => t.preset)}
          onClose={() => setTransforming(null)}
        />
      )}
    </div>
  );
}
