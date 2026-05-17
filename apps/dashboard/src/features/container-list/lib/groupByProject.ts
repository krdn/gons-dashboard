import type { ContainerSummary, ContainerState } from "@/entities/container/client";
import type { Project } from "@/entities/project/client";

export type ProjectGroup = {
  composeProject: string;
  displayName: string;
  description: string | null;
  category: string | null;
  url: string | null;
  isPinned: boolean;
  isStandalone: boolean;
  isStale: boolean;
  containers: ContainerSummary[];
  runningCount: number;
  totalCount: number;
  warningCount: number;
};

const WARNING_STATES: ReadonlySet<ContainerState> = new Set([
  "exited",
  "restarting",
  "dead",
  "paused",
]);

const STANDALONE = "standalone";

type MakeGroupArgs = {
  composeProject: string;
  displayName: string;
  description: string | null;
  category: string | null;
  url: string | null;
  isPinned: boolean;
  isStandalone: boolean;
  containers: ContainerSummary[];
};

function makeGroup(args: MakeGroupArgs): ProjectGroup {
  let running = 0;
  let warning = 0;
  for (const cont of args.containers) {
    if (cont.state === "running") running++;
    if (WARNING_STATES.has(cont.state)) warning++;
  }
  return {
    ...args,
    isStale: !args.isStandalone && args.containers.length === 0,
    runningCount: running,
    totalCount: args.containers.length,
    warningCount: warning,
  };
}

export function groupByProject(
  containers: ContainerSummary[],
  projects: Project[],
): ProjectGroup[] {
  const visibleProjects = projects.filter((p) => !p.isHidden);
  const visibleByCompose = new Map(
    visibleProjects.map((p) => [p.composeProject, p]),
  );
  const hiddenSet = new Set(
    projects.filter((p) => p.isHidden).map((p) => p.composeProject),
  );

  // 1. 각 visible project를 슬롯으로 만든다 (live 0개여도 그룹 생성).
  const projectBuckets = new Map<string, ContainerSummary[]>(
    visibleProjects.map((p) => [p.composeProject, []]),
  );
  const standaloneBucket: ContainerSummary[] = [];

  // 2. 컨테이너를 슬롯에 분배.
  for (const cont of containers) {
    if (cont.composeProject == null) {
      standaloneBucket.push(cont);
      continue;
    }
    if (hiddenSet.has(cont.composeProject)) continue; // hidden 그룹은 표시 안 함
    const slot = projectBuckets.get(cont.composeProject);
    if (slot != null) {
      slot.push(cont);
    } else {
      // visible project에 매칭 안 되면 standalone fallback
      standaloneBucket.push(cont);
    }
  }

  // 3. 그룹 생성.
  const groups: ProjectGroup[] = [];
  for (const [key, list] of projectBuckets) {
    const meta = visibleByCompose.get(key)!;
    groups.push(
      makeGroup({
        composeProject: key,
        displayName: meta.displayName,
        description: meta.description ?? null,
        category: meta.category ?? null,
        url: meta.url ?? null,
        isPinned: meta.isPinned,
        isStandalone: false,
        containers: list,
      }),
    );
  }
  if (standaloneBucket.length > 0) {
    groups.push(
      makeGroup({
        composeProject: STANDALONE,
        displayName: "standalone",
        description: null,
        category: null,
        url: null,
        isPinned: false,
        isStandalone: true,
        containers: standaloneBucket,
      }),
    );
  }

  return groups.sort((a, b) => {
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.composeProject.localeCompare(b.composeProject);
  });
}
