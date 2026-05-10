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
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="font-medium">{host.name}</span>
      {host.description ? (
        <span className="text-zinc-500">({host.description})</span>
      ) : null}
    </span>
  );
}
