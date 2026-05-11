import { ContainerRow } from "@/entities/container";
import { ProjectCard } from "@/entities/project";
import type { ProjectGroup } from "../lib/groupByProject";

type Props = {
  group: ProjectGroup;
  renderActions?: (containerId: string, containerName: string) => React.ReactNode;
};

export function ProjectGroupSection({ group, renderActions }: Props) {
  return (
    <ProjectCard
      project={{
        displayName: group.displayName,
        description: group.description,
        isPinned: group.isPinned,
        composeProject: group.composeProject,
      }}
      totalContainers={group.totalCount}
      runningContainers={group.runningCount}
      warningCount={group.warningCount}
    >
      {group.isStale ? (
        <div className="flex flex-col gap-2 bg-zinc-50 px-4 py-4 text-sm text-zinc-600 sm:flex-row sm:items-center dark:bg-zinc-900/60 dark:text-zinc-300">
          <span
            className="inline-flex w-fit items-center rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            title="화이트리스트엔 등록되어 있으나 현재 실행 중인 컨테이너가 없습니다"
          >
            no live containers
          </span>
          <span>실행 중인 컨테이너가 없습니다</span>
        </div>
      ) : (
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
      )}
    </ProjectCard>
  );
}
