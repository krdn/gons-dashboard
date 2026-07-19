// 전체 상태 신호등 — 색 + 텍스트 병행 (색만으로 전달 금지, WCAG).
export type OverallStatus = "ok" | "warning" | "critical";

const STYLE: Record<OverallStatus, { color: string; label: string }> = {
  ok: { color: "var(--color-severity-ok)", label: "정상" },
  warning: { color: "var(--color-warn)", label: "주의" },
  critical: { color: "var(--color-severity-high)", label: "위험" },
};

export function StatusDot({
  status,
  showLabel = true,
}: {
  status: OverallStatus;
  showLabel?: boolean;
}) {
  const { color, label } = STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {showLabel && (
        <span className="text-sm font-semibold" style={{ color }}>
          {label}
        </span>
      )}
      {!showLabel && <span className="sr-only">{label}</span>}
    </span>
  );
}
