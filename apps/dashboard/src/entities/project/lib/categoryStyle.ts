// category 값에 따른 표시 스타일(색상 클래스 등)을 반환한다.
// 현재는 기본값만 정의 — 카테고리 기능 확장 시 확충 예정.

export type CategoryStyle = {
  label: string;
  colorClass: string;
};

const DEFAULT_STYLE: CategoryStyle = {
  label: "기타",
  colorClass: "bg-zinc-100 text-zinc-600",
};

const CATEGORY_MAP: Record<string, CategoryStyle> = {
  ai: { label: "AI", colorClass: "bg-violet-100 text-violet-700" },
  news: { label: "뉴스", colorClass: "bg-blue-100 text-blue-700" },
  infra: { label: "인프라", colorClass: "bg-zinc-200 text-zinc-700" },
  dashboard: { label: "대시보드", colorClass: "bg-emerald-100 text-emerald-700" },
};

export function categoryStyle(category: string | null): CategoryStyle {
  if (!category) return DEFAULT_STYLE;
  return CATEGORY_MAP[category.toLowerCase()] ?? DEFAULT_STYLE;
}
