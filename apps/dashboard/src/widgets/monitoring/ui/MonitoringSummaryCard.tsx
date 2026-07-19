// 홈 대시보드 aside 요약 — 전체 신호등 + 미해결 이벤트 수 + 마지막 수집.
// 상세는 /monitoring (이슈 #323 §3: 메인엔 요약 위젯 1개만 — 기존 그리드 존중).
import "server-only";
import Link from "next/link";
import {
  countOpenEvents,
  getLatestHostMetrics,
} from "@/entities/monitoring/server";
import { formatAgo } from "../lib/format";
import { StatusDot, type OverallStatus } from "./StatusDot";

export async function MonitoringSummaryCard() {
  const [open, snapshots] = await Promise.all([
    countOpenEvents(),
    getLatestHostMetrics(),
  ]);

  const status: OverallStatus =
    open.critical > 0 ? "critical" : open.warning > 0 ? "warning" : "ok";
  const lastCollectedAt = snapshots.reduce<Date | null>(
    (max, s) =>
      s.lastCollectedAt != null && (max == null || s.lastCollectedAt > max)
        ? s.lastCollectedAt
        : max,
    null,
  );

  return (
    <section
      aria-labelledby="monitoring-summary-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4 text-[var(--color-text)]"
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 id="monitoring-summary-title" className="text-base font-semibold tracking-tight">
          관제
        </h2>
        <StatusDot status={status} />
      </header>
      <p className="text-sm text-[var(--color-text-muted)]">
        {open.critical + open.warning === 0 ? (
          "미해결 이벤트 없음"
        ) : (
          <>
            미해결{" "}
            {open.critical > 0 && (
              <span className="font-semibold text-[var(--color-severity-high)]">
                위험 {open.critical}
              </span>
            )}
            {open.critical > 0 && open.warning > 0 && " · "}
            {open.warning > 0 && (
              <span className="font-semibold text-[var(--color-warn)]">
                경고 {open.warning}
              </span>
            )}
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
        {lastCollectedAt == null
          ? "지표 수집 대기 중"
          : `마지막 수집 ${formatAgo(lastCollectedAt)}`}
      </p>
      <Link
        href="/monitoring"
        className="mt-2 inline-block text-sm text-[var(--color-accent)] hover:underline"
      >
        관제 보드 →
      </Link>
    </section>
  );
}

export function MonitoringSummarySkeleton() {
  return (
    <section
      aria-hidden
      className="animate-pulse rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <div className="mb-3 h-5 w-16 rounded bg-[var(--color-surface-2)]" />
      <div className="h-4 w-40 rounded bg-[var(--color-surface-2)]" />
      <div className="mt-2 h-3 w-28 rounded bg-[var(--color-surface-2)]" />
    </section>
  );
}
