// 자동 복구 시도 보드 — Phase 1 dry-run 로그 검토용 (이슈 #352).
// DB 를 직접 조회해야만 결과가 보이면 아무도 검토하지 않는다는 게 이 보드의 존재
// 이유다. outcome 5종(in_flight/executed/dry_run/skipped/failed) 전부 배지로
// 노출해야 한다 — Phase 1 은 거의 모든 행이 dry_run 이라 이 배지가 빠지면
// 보드가 사실상 비어 보인다.
import "server-only";
import { type RemediationAttemptRow } from "@/entities/monitoring/server";
import { formatAgo, formatKstTime } from "../lib/format";

const OUTCOME_STYLE: Record<
  string,
  { color: string; bg: string; label: string; mark: string }
> = {
  in_flight: {
    color: "var(--color-warn)",
    bg: "color-mix(in oklch, var(--color-warn) 12%, white)",
    label: "진행중",
    mark: "…",
  },
  executed: {
    color: "var(--color-severity-ok)",
    bg: "color-mix(in oklch, var(--color-severity-ok) 12%, white)",
    label: "실행됨",
    mark: "✓",
  },
  dry_run: {
    color: "var(--color-accent)",
    bg: "color-mix(in oklch, var(--color-accent) 12%, white)",
    label: "dry-run",
    mark: "◐",
  },
  skipped: {
    color: "var(--color-text-muted)",
    bg: "var(--color-surface-2)",
    label: "스킵",
    mark: "○",
  },
  failed: {
    color: "var(--color-severity-high)",
    bg: "color-mix(in oklch, var(--color-severity-high) 12%, white)",
    label: "실패",
    mark: "✕",
  },
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const s = OUTCOME_STYLE[outcome] ?? {
    color: "var(--color-text-muted)",
    bg: "var(--color-surface-2)",
    label: outcome,
    mark: "?",
  };
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

function DryRunBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
      dry-run
    </span>
  );
}

export function RemediationBoard({
  rows,
  now,
}: {
  rows: RemediationAttemptRow[];
  now: Date;
}) {
  return (
    <section
      aria-labelledby="remediation-board-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="remediation-board-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        자동 복구 시도
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          시도 기록 없음 — 아직 조치 대상 이벤트가 없습니다.
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-[var(--color-hairline)] p-2.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <OutcomeBadge outcome={r.outcome} />
                {r.dryRun && <DryRunBadge />}
                <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {r.policyId}
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-[var(--color-text-subtle)]">
                  {formatKstTime(r.attemptedAt)} · {formatAgo(r.attemptedAt, now)}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[var(--color-text)]">{r.action}</p>
              {r.reason && (
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {r.reason}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
