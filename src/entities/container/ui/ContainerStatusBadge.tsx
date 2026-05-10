import type { ContainerState } from "../model/types";

const STYLE: Record<ContainerState, { bg: string; label: string }> = {
  running: {
    bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    label: "running",
  },
  exited: {
    bg: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
    label: "exited",
  },
  restarting: {
    bg: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    label: "restarting",
  },
  paused: {
    bg: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    label: "paused",
  },
  dead: {
    bg: "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-200",
    label: "dead",
  },
  created: {
    bg: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
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
