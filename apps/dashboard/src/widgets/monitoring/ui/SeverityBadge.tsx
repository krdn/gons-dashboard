// 이벤트 severity 배지 — 아이콘 문자 + 텍스트 병행.
import { type EventSeverity } from "@/entities/monitoring/server";

const STYLE: Record<
  EventSeverity,
  { color: string; bg: string; label: string; mark: string }
> = {
  critical: {
    color: "var(--color-severity-high)",
    bg: "color-mix(in oklch, var(--color-severity-high) 12%, white)",
    label: "위험",
    mark: "●",
  },
  warning: {
    color: "var(--color-warn)",
    bg: "color-mix(in oklch, var(--color-warn) 12%, white)",
    label: "경고",
    mark: "▲",
  },
  info: {
    color: "var(--color-text-muted)",
    bg: "var(--color-surface-2)",
    label: "정보",
    mark: "○",
  },
};

export function SeverityBadge({ severity }: { severity: EventSeverity }) {
  const s = STYLE[severity];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      <span aria-hidden>{s.mark}</span>
      {s.label}
    </span>
  );
}

export function ResolvedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-severity-ok)]">
      ✓ 해소
    </span>
  );
}
