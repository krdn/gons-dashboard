import type { Host } from "../model/types";

type Props = {
  host: Pick<Host, "name" | "description">;
  status?: "ok" | "warn" | "down";
};

export function HostBadge({ host, status = "ok" }: Props) {
  const dot =
    status === "ok"
      ? "bg-emerald-500"
      : status === "warn"
        ? "bg-[oklch(96%_0.04_70)]0"
        : "bg-[oklch(96%_0.04_28)]0";
  return (
    <span className="inline-flex items-center gap-2 text-sm text-[var(--color-text)]">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="font-medium">{host.name}</span>
      {host.description ? (
        <span className="text-[var(--color-text-subtle)]">
          ({host.description})
        </span>
      ) : null}
    </span>
  );
}
