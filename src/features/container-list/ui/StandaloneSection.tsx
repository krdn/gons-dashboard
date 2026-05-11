// barrel 우회 — entities/container/index.ts 는 server-only API(listContainers)도 함께
// export 하므로, 클라이언트 트리에서 사용될 가능성이 있는 UI 는 깊은 경로로 직접 import 한다.
import { ContainerRow } from "@/entities/container/ui/ContainerRow";
import type { ProjectGroup } from "../lib/groupByProject";

type Props = {
  group: ProjectGroup;
  renderActions?: (containerId: string, containerName: string) => React.ReactNode;
};

export function StandaloneSection({ group, renderActions }: Props) {
  if (group.containers.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-white text-zinc-950 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          standalone (compose 라벨 없음)
        </h2>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
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
