import type { ContainerState } from "../model/types";

const STYLE: Record<ContainerState, { bg: string; label: string }> = {
  running: {
    bg: "bg-[oklch(96%_0.04_155)] text-[var(--color-severity-ok)]",
    label: "running",
  },
  exited: {
    bg: "bg-rose-100 text-[var(--color-severity-high)]",
    label: "exited",
  },
  restarting: {
    bg: "bg-amber-100 text-[var(--color-warn)]",
    label: "restarting",
  },
  paused: {
    bg: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    label: "paused",
  },
  dead: {
    bg: "bg-rose-200 text-rose-900",
    label: "dead",
  },
  created: {
    bg: "bg-sky-100 text-sky-800",
    label: "created",
  },
};

export function ContainerStatusBadge({ state }: { state: ContainerState }) {
  const s = STYLE[state];
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${s.bg}`}>
      {s.label}
    </span>
  );
}
