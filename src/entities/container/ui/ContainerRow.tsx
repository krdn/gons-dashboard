import type { ContainerSummary } from "../model/types";
import { ContainerStatusBadge } from "./ContainerStatusBadge";

type Props = {
  container: ContainerSummary;
  actions?: React.ReactNode;
};

export function ContainerRow({ container, actions }: Props) {
  const portsText = container.ports
    .filter((p) => p.hostPort != null)
    .map((p) => `:${p.hostPort}`)
    .join(" ");
  return (
    <div className="flex flex-col gap-3 px-4 py-3 text-sm transition-colors hover:bg-zinc-50/60 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <ContainerStatusBadge state={container.state} />
        <div className="min-w-0">
          <div className="truncate font-mono font-medium text-zinc-900">
            {container.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span className="truncate">{container.statusText}</span>
            {portsText ? (
              <span className="font-mono text-zinc-400">
                {portsText}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? <div className="shrink-0 sm:ml-4">{actions}</div> : null}
    </div>
  );
}
