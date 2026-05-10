import { ContainerRow } from "@/entities/container";
import type { ProjectGroup } from "../lib/groupByProject";

type Props = {
  group: ProjectGroup;
  renderActions?: (containerId: string, containerName: string) => React.ReactNode;
};

export function StandaloneSection({ group, renderActions }: Props) {
  if (group.containers.length === 0) return null;
  return (
    <section className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
          standalone (compose 라벨 없음)
        </h2>
        <span className="text-xs text-zinc-500">
          {group.runningCount}/{group.totalCount} running
        </span>
      </header>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
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
