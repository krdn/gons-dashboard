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
        ? "bg-[oklch(96%_0.04_70)]0 text-white"
        : "bg-zinc-900 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] " +
        (active ? activeColor : "text-[var(--color-text-muted)] hover:bg-white")
      }
    >
      {label}
    </button>
  );
}
