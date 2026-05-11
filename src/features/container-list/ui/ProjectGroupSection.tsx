// barrel 우회 — entities/* 의 index.ts 는 server-only API 도 함께 export 하므로
// 클라이언트 트리에서 사용될 가능성이 있는 UI 는 깊은 경로로 직접 import 한다.
// (호스트 상세 페이지의 HostDashboard 클라이언트 컴포넌트에서 사용됨)
import { ContainerRow } from "@/entities/container/ui/ContainerRow";
import { ProjectCard } from "@/entities/project/ui/ProjectCard";
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
        <div className="flex flex-col gap-2 bg-[var(--color-surface-2)] px-4 py-4 text-sm text-[var(--color-text-muted)] sm:flex-row sm:items-center">
          <span
            className="inline-flex w-fit items-center rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]"
            title="화이트리스트엔 등록되어 있으나 현재 실행 중인 컨테이너가 없습니다"
          >
            no live containers
          </span>
          <span>실행 중인 컨테이너가 없습니다</span>
        </div>
      ) : (
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
      )}
    </ProjectCard>
  );
}
