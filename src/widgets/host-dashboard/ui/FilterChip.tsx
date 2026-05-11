"use client";

// ControlBar 의 상태 필터 칩. tone 별 active 색상 분기.

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
  tone?: "ok" | "warn";
}

export function FilterChip({ label, active, onClick, title, tone }: FilterChipProps) {
  const activeColor =
    tone === "ok"
      ? "bg-emerald-600 text-white"
      : tone === "warn"
        ? "bg-amber-500 text-white"
        : "bg-zinc-900 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "rounded-md px-2.5 py-1 font-medium transition-colors " +
        (active ? activeColor : "text-zinc-600 hover:bg-white")
      }
    >
      {label}
    </button>
  );
}
