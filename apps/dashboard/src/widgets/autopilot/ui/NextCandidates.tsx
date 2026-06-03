"use client";

import type { BacklogCandidate } from "@/entities/autopilot-cycle/client";

export function NextCandidates({ candidates }: { candidates: BacklogCandidate[] }) {
  if (candidates.length === 0) {
    return (
      <p className="py-2 text-xs italic text-[var(--color-text-subtle)]">
        사이클이 토론을 거쳐 후보를 선정하면 여기에 TOP 3가 표시됩니다
      </p>
    );
  }

  return (
    <ul className="space-y-1 text-sm">
      {candidates.map((b) => (
        <li key={b.dedupKey} className="flex items-center justify-between gap-2">
          <span className="truncate">· {b.title}</span>
          <span className="shrink-0 tabular-nums text-xs text-[var(--color-text-muted)]">
            score {b.score.toFixed(1)}
          </span>
        </li>
      ))}
    </ul>
  );
}
