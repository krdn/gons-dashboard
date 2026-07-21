// 이벤트 타임라인 — 관제의 척추 (이슈 #323 §2-K). severity 는 색+아이콘+텍스트 병행.
// resolved 는 muted + "해소" 배지 (취소선 아님 — 스크린리더·가독성).
// 세로 길이 억제 (#342): 초기 INITIAL 건만 노출, 나머지는 "더보기" 토글로 펼침.
"use client";
import { useState } from "react";
import { type MonitoringEventRow } from "@/entities/monitoring/server";
import { type EventSeverity } from "@/entities/monitoring/server";
import { formatAgo, formatKstTime } from "../lib/format";
import { SeverityBadge, ResolvedBadge } from "./SeverityBadge";

// 초기 노출 건수 — 4fr 좁은 컬럼에서 VitalsBoard 세로 높이와 균형.
const INITIAL = 8;

const SOURCE_LABEL: Record<string, string> = {
  host: "호스트",
  container: "컨테이너",
  cron: "cron",
  service: "서비스",
  security: "보안",
  ssl: "SSL",
  http: "HTTP",
};

export function EventsTimeline({
  events,
  now,
}: {
  events: MonitoringEventRow[];
  now: Date;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = events.length > INITIAL;
  const visible = expanded ? events : events.slice(0, INITIAL);
  return (
    <section
      aria-labelledby="events-timeline-title"
      className="rounded-xl border border-[var(--color-hairline)] bg-white p-4"
    >
      <h2
        id="events-timeline-title"
        className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        이벤트
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {events.length}
        </span>
      </h2>
      {events.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
          이벤트 없음 — 모든 지표가 정상 범위입니다.
        </p>
      ) : (
        <ol className="space-y-2">
          {visible.map((e) => {
            const resolved = e.resolvedAt != null;
            return (
              <li
                key={e.id}
                className={`rounded-lg border border-[var(--color-hairline)] p-2.5 ${
                  resolved ? "opacity-60" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityBadge severity={e.severity as EventSeverity} />
                  {resolved && <ResolvedBadge />}
                  <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-[var(--color-text-subtle)]">
                    {formatKstTime(e.occurredAt)} · {formatAgo(e.occurredAt, now)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-[var(--color-text)]">{e.title}</p>
                {e.detail && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {e.detail}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 w-full rounded-b-lg border-t border-[var(--color-hairline)] pt-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
        >
          {expanded ? "접기" : `더보기 ${events.length - INITIAL}건`}
        </button>
      )}
    </section>
  );
}
