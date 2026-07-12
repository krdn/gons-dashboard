"use client";
import { useState } from "react";
import { ACTION_ITEM_KIND_LABELS, type MemoActionItem } from "@/entities/memo/client";
import { updateActionItemStatusAction, type ActionItemStatusUpdate } from "../client";
import { formatDueLabel } from "../lib/dates";

interface MemoActionPanelProps {
  /** 이 메모의 proposed·accepted 항목 (dismissed/done은 조회 단계에서 이미 제외). */
  items: MemoActionItem[];
}

// 카드 본문 아래 액션 제안·할일 패널 — 갱신은 Server Action의 revalidatePath가
// 페이지 props를 다시 내려보내는 것에 의존 (별도 로컬 목록 상태 없음).
export function MemoActionPanel({ items }: MemoActionPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 렌더 중 Date.now() 직접 호출은 React 19 purity 위반 — 마운트 시각으로 고정
  // (기한 경과 표시는 분 단위 정밀도면 충분, lazy initializer는 순수 규칙 허용 경계).
  const [now] = useState(() => Date.now());

  if (items.length === 0) return null;

  function transition(id: string, to: ActionItemStatusUpdate) {
    setBusyId(id);
    updateActionItemStatusAction(id, to).then(
      (r) => {
        setBusyId(null);
        setNotice(r.kind === "ok" ? null : "처리에 실패했습니다 — 다시 시도해 주세요.");
      },
      () => {
        setBusyId(null);
        setNotice("처리에 실패했습니다 — 다시 시도해 주세요.");
      },
    );
  }

  return (
    <div className="mt-2 space-y-1.5 rounded border border-neutral-100 bg-neutral-50 px-3 py-2">
      {notice && <p className="text-xs text-red-600">{notice}</p>}
      {items.map((item) => {
        const busy = busyId === item.id;
        const overdue = item.dueAt !== null && item.dueAt.getTime() < now;
        const due = item.dueAt && (
          <time className={`text-xs ${overdue ? "text-red-600" : "text-neutral-400"}`}>
            {formatDueLabel(item.dueAt, item.allDay)}
          </time>
        );
        return item.status === "proposed" ? (
          <div key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-neutral-400">
              → {ACTION_ITEM_KIND_LABELS[item.kind as "todo" | "event"] ?? item.kind} 제안
            </span>
            <span className="text-neutral-700">{item.title}</span>
            {due}
            <span className="ml-auto flex shrink-0 gap-2 text-xs text-neutral-400">
              <button
                type="button"
                disabled={busy}
                onClick={() => transition(item.id, "accepted")}
                className="hover:text-neutral-900 disabled:opacity-50"
              >
                수락
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => transition(item.id, "dismissed")}
                className="hover:text-red-600 disabled:opacity-50"
              >
                무시
              </button>
            </span>
          </div>
        ) : (
          <div key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() => transition(item.id, "done")}
              aria-label={`${item.title} 완료`}
              className="text-xs text-neutral-400 hover:text-neutral-900 disabled:opacity-50"
            >
              ☐ 완료
            </button>
            <span className="text-neutral-700">{item.title}</span>
            {due}
            <button
              type="button"
              disabled={busy}
              onClick={() => transition(item.id, "dismissed")}
              className="ml-auto shrink-0 text-xs text-neutral-400 hover:text-red-600 disabled:opacity-50"
            >
              무시
            </button>
          </div>
        );
      })}
    </div>
  );
}
