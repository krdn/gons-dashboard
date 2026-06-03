"use client";

import type { AutopilotStatus as Status } from "@/entities/autopilot-cycle/client";

export function AutopilotStatus({ status }: { status: Status }) {
  const modeLabel = status.mode ?? "shadow";
  const deployLabel =
    status.deployFlag === "on"
      ? "배포 ON"
      : status.deployFlag === "off"
        ? "배포 OFF"
        : "배포 미상";

  return (
    <div className="flex items-center justify-between">
      <strong className="text-sm font-semibold">🤖 Autopilot — 주간 자율 업그레이드</strong>
      <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
        {modeLabel} · {deployLabel}
      </span>
    </div>
  );
}

export function AutopilotMeta({ status }: { status: Status }) {
  return (
    <div className="mt-2 flex gap-4 text-xs text-[var(--color-text-muted)]">
      <span>
        다음 사이클 · <b className="text-[var(--color-text)]">{status.nextCycleLabel}</b>
      </span>
      <span>
        마지막 실행 · <b className="text-[var(--color-text)]">{status.lastRunIsoWeek ?? "없음"}</b>
      </span>
    </div>
  );
}
