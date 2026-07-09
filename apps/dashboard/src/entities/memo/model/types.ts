import type { memos, memoTransformations } from "@/shared/lib/db/schema";

export type Memo = typeof memos.$inferSelect;
export type MemoSource = "voice" | "text";

export type MemoTransformation = typeof memoTransformations.$inferSelect;

// 스타일 변환 프리셋 — DB CHECK(memo_transformations_preset_check)와 동기 유지.
export const TRANSFORM_PRESET_IDS = [
  "tidy",
  "polish",
  "summary",
  "structured",
  "todos",
  "journal",
  "email",
] as const;
export type TransformPresetId = (typeof TRANSFORM_PRESET_IDS)[number];

// 칩·다이얼로그 표시 라벨. entities에 두는 이유: MemoCard(entity ui)는
// features를 import할 수 없다 (FSD 방향) — features/memo-transform이 이걸 참조.
export const TRANSFORM_PRESET_LABELS: Record<TransformPresetId, string> = {
  tidy: "정돈",
  polish: "매끄럽게",
  summary: "요약",
  structured: "구조화",
  todos: "할 일 추출",
  journal: "일기체",
  email: "이메일 초안",
};

const MAX_TITLE_LEN = 50;

/** cleaned_content 첫 문장에서 제목 파생. 저장 시점에 title 확정값 생성용. */
export function deriveTitle(cleaned: string): string {
  const trimmed = cleaned.trim();
  if (trimmed.length === 0) return "(제목 없음)";
  // 첫 문장 (마침표/물음표/느낌표 기준). 없으면 전체.
  const firstSentence = trimmed.split(/[.!?。\n]/)[0].trim();
  const base = firstSentence.length > 0 ? firstSentence : trimmed;
  return base.length > MAX_TITLE_LEN ? base.slice(0, MAX_TITLE_LEN) : base;
}
