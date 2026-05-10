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
    <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <ContainerStatusBadge state={container.state} />
        <span className="truncate font-mono">{container.name}</span>
        <span className="truncate text-zinc-500">{container.statusText}</span>
        {portsText ? <span className="text-zinc-400">{portsText}</span> : null}
      </div>
      {actions}
    </div>
  );
}
