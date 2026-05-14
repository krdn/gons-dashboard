import { ContainerRow } from "@/entities/container/client";
import type { ProjectGroup } from "../lib/groupByProject";

type Props = {
  group: ProjectGroup;
  renderActions?: (containerId: string, containerName: string) => React.ReactNode;
};

export function StandaloneSection({ group, renderActions }: Props) {
  if (group.containers.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-white text-[var(--color-text)] shadow-sm">
      <header className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-muted)]">
          standalone (compose 라벨 없음)
        </h2>
        <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 font-mono text-xs text-[var(--color-text-muted)]">
          {group.runningCount}/{group.totalCount} running
        </span>
      </header>
      <ul className="divide-y divide-zinc-100">
        {group.containers.map((c) => (
          <li key={c.id}>
            <ContainerRow
              container={c}
              actions={renderActions ? renderActions(c.id, c.name) : null}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
