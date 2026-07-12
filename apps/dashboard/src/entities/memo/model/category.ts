// 메모 자동 분류 카테고리 — 주제(topic)가 아니라 글의 종류(content-type) 기준.
// DB CHECK(memos_category_check)와 반드시 동기 유지 (스펙 2026-07-12-memo-category-tagging).
export const MEMO_CATEGORY_IDS = [
  "idea",
  "todo",
  "journal",
  "reference",
  "draft",
  "etc",
] as const;
export type MemoCategory = (typeof MEMO_CATEGORY_IDS)[number];

// 칩·뱃지 표시 라벨. TRANSFORM_PRESET_LABELS와 같은 이유로 entities 소유 —
// MemoCard(entity ui)가 참조하고 features는 client barrel로 재사용.
export const MEMO_CATEGORY_LABELS: Record<MemoCategory, string> = {
  idea: "아이디어",
  todo: "할 일",
  journal: "일기",
  reference: "참고",
  draft: "초안",
  etc: "기타",
};

export function isMemoCategory(value: unknown): value is MemoCategory {
  return (
    typeof value === "string" &&
    (MEMO_CATEGORY_IDS as readonly string[]).includes(value)
  );
}
