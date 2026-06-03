"use client";

import type { AutopilotCycle } from "@/entities/autopilot-cycle/client";

function statusBadge(c: AutopilotCycle): { text: string; cls: string } {
  if (c.reason) return { text: c.reason, cls: "text-[var(--color-text-subtle)]" };
  if (c.merged) return { text: "✓머지", cls: "text-[var(--color-text-muted)]" };
  if (c.needsHuman) return { text: "⚠needs-human", cls: "text-[var(--color-warn)]" };
  return { text: "PR 생성", cls: "text-[var(--color-text-muted)]" };
}

export function CycleHistoryList({ cycles }: { cycles: AutopilotCycle[] }) {
  if (cycles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] py-5 text-center text-xs text-[var(--color-text-subtle)]">
        첫 사이클이 아직 실행되지 않았습니다 · shadow 모드로 대기 중
      </div>
    );
  }

  return (
    <ul className="space-y-1.5 text-sm">
      {cycles.map((c) => {
        const badge = statusBadge(c);
        return (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs text-[var(--color-text-subtle)]">{c.isoWeek}</span>
              <span className="truncate">{c.selectedTitle ?? "(후보 선정 안 됨)"}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs">
              {c.selectedScore != null && (
                <span className="tabular-nums text-[var(--color-text-muted)]">
                  score {c.selectedScore.toFixed(1)}
                </span>
              )}
              {c.prUrl ? (
                <a
                  href={c.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${badge.cls} hover:underline`}
                >
                  {badge.text}
                </a>
              ) : (
                <span className={badge.cls}>{badge.text}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
