// 이유 뱃지 + severity 텍스트 뱃지.
// 와이어프레임의 .badge / [data-severity-label] 시각 결정 그대로.
// WCAG 1.4.1 — severity는 색이 아닌 텍스트 단어로도 명시 ("지금 답해야"/"오늘 안").

import type { DigestSeverity } from "@/entities/digest";

interface ReplyBadgesProps {
  severity: DigestSeverity;
  reason: string;
}

const SEVERITY_LABEL: Record<DigestSeverity, string | null> = {
  high: "지금 답해야",
  med: "오늘 안",
  low: null,
};

export function ReplyBadges({ severity, reason }: ReplyBadgesProps) {
  const severityLabel = SEVERITY_LABEL[severity];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {severityLabel && (
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-tiny font-semibold",
            severity === "high"
              ? "border-[oklch(80%_0.10_28)] text-[oklch(40%_0.16_28)]"
              : "border-[oklch(80%_0.08_70)] text-[oklch(40%_0.13_70)]",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-current opacity-60"
          />
          {severityLabel}
        </span>
      )}
      <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-2 py-0.5 text-tiny font-medium text-[var(--color-text-muted)]">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55"
        />
        <span className="truncate">{reason}</span>
      </span>
    </div>
  );
}
