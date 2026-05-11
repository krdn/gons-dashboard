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
