import type { memos } from "@/shared/lib/db/schema";

export type Memo = typeof memos.$inferSelect;
export type MemoSource = "voice" | "text";

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
