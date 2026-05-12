// 카테고리 뱃지 — 4종 카테고리 + importance(high/med) 표시.
// 색상은 카테고리별 의미적 매핑: money=amber, security=rose, schedule=sky, notice=stone.
// importance=high면 "·high" 접미.
import type { Category, ImportantImportance } from "@/entities/email/model/types";

const LABELS: Record<Category, string> = {
  money: "금전",
  security: "보안",
  schedule: "일정",
  notice: "공지",
};

const CATEGORY_CLASSES: Record<Category, string> = {
  money: "bg-[oklch(96%_0.04_70)] text-amber-900 border-[var(--color-warn)]",
  security: "bg-[oklch(96%_0.04_28)] text-rose-900 border-[var(--color-severity-high)]",
  schedule: "bg-sky-50 text-sky-900 border-sky-200",
  notice: "bg-stone-50 text-stone-900 border-stone-200",
};

export function CategoryBadge({
  category,
  importance,
}: {
  category: Category;
  importance: ImportantImportance;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums ${CATEGORY_CLASSES[category]}`}
    >
      <span>{LABELS[category]}</span>
      {importance === "high" && (
        <span aria-label="높음" className="font-bold">·high</span>
      )}
    </span>
  );
}
