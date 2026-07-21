// GitHub 관제 수동 새로고침 버튼 (이슈 #333).
// 클릭 시 refreshGithubMonitor Server Action 을 호출해 즉시 재수집하고,
// 성공하면 router.refresh() 로 RSC 를 재요청해 방금 갱신된 스냅샷을 표시한다.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { refreshGithubMonitor } from "../client";
import type { RefreshResult } from "../model/types";

/** ok 결과를 사람이 읽을 피드백 문구로. */
function successLabel(result: RefreshResult): string {
  const s = result.summary;
  if (!s) return "갱신 완료";
  if (s.skipped && s.lockBusy) return "동기화 진행 중 — 곧 반영됩니다";
  if (s.skipped) return "토큰 미설정 — 동기화 비활성";
  return `갱신 완료 · 이슈 ${s.issues} · PR ${s.pulls} · 레포 ${s.runs}`;
}

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await refreshGithubMonitor();
      setResult(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-50"
      >
        {isPending ? "새로고침 중…" : "새로고침"}
      </button>
      {result?.ok && (
        <p className="max-w-xs text-right text-xs text-[var(--color-text-muted)]">
          {successLabel(result)}
        </p>
      )}
      {result && !result.ok && (
        <p className="max-w-xs text-right text-xs text-[var(--color-severity-high)]">
          {result.error}
        </p>
      )}
    </div>
  );
}
