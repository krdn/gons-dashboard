// 메모 액션 아이템(할일·일정 제안) 상수·타입 — client 안전 (스펙 2026-07-12-memo-action-extraction).
// DB CHECK(memo_action_items_kind/status)와 반드시 동기 유지.
export const ACTION_ITEM_KINDS = ["todo", "event"] as const;
export type ActionItemKind = (typeof ACTION_ITEM_KINDS)[number];

export const ACTION_ITEM_STATUSES = ["proposed", "accepted", "dismissed", "done"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

export const ACTION_ITEM_KIND_LABELS: Record<ActionItemKind, string> = {
  todo: "할 일",
  event: "일정",
};

/**
 * 상태 기계 — proposed ─수락→ accepted ─완료→ done, proposed/accepted ─무시→ dismissed.
 * dismissed/done은 종단 (스펙 §5). UI·Server Action·repo WHERE 절이 공유하는 단일 정의.
 */
export const ACTION_ITEM_ALLOWED_FROM: Record<ActionItemStatus, readonly ActionItemStatus[]> = {
  proposed: [],
  accepted: ["proposed"],
  dismissed: ["proposed", "accepted"],
  done: ["accepted"],
};

export function isActionItemKind(value: unknown): value is ActionItemKind {
  return typeof value === "string" && (ACTION_ITEM_KINDS as readonly string[]).includes(value);
}

export function isActionItemStatus(value: unknown): value is ActionItemStatus {
  return (
    typeof value === "string" && (ACTION_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransition(from: ActionItemStatus, to: ActionItemStatus): boolean {
  return (ACTION_ITEM_ALLOWED_FROM[to] as readonly string[]).includes(from);
}
