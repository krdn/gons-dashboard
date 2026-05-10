import type { ContainerSummary, ContainerState } from "@/entities/container";
import type { Project } from "@/entities/project";

export type ProjectGroup = {
  composeProject: string;
  displayName: string;
  description: string | null;
  isPinned: boolean;
  isStandalone: boolean;
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

// 라벨 없는 컨테이너의 가상 그룹 키. 만약 사용자가 실제로 "standalone"이라는
// compose project 이름을 쓰게 되면 라벨 있는 컨테이너와 라벨 없는 컨테이너가
// 같은 버킷으로 병합된다 (현재 운영 중인 프로젝트 이름엔 충돌 없음). 충돌이
// 발생하면 키를 고유 sentinel로 바꾸거나 Map<string|null,...> 형태로 변경.
const STANDALONE = "standalone";

function makeGroup(
  composeProject: string,
  displayName: string,
  description: string | null,
  isPinned: boolean,
  isStandalone: boolean,
  containers: ContainerSummary[],
): ProjectGroup {
  let running = 0;
  let warning = 0;
  for (const cont of containers) {
    if (cont.state === "running") running++;
    if (WARNING_STATES.has(cont.state)) warning++;
  }
  return {
    composeProject,
    displayName,
    description,
    isPinned,
    isStandalone,
    containers,
    runningCount: running,
    totalCount: containers.length,
    warningCount: warning,
  };
}

export function groupByProject(
  containers: ContainerSummary[],
  projects: Project[],
): ProjectGroup[] {
  const projectByCompose = new Map(projects.map((p) => [p.composeProject, p]));
  const hiddenSet = new Set(
    projects.filter((p) => p.isHidden).map((p) => p.composeProject),
  );

  const buckets = new Map<string, ContainerSummary[]>();
  for (const cont of containers) {
    if (cont.composeProject == null) {
      const arr = buckets.get(STANDALONE) ?? [];
      arr.push(cont);
      buckets.set(STANDALONE, arr);
      continue;
    }
    if (hiddenSet.has(cont.composeProject)) continue;
    const arr = buckets.get(cont.composeProject) ?? [];
    arr.push(cont);
    buckets.set(cont.composeProject, arr);
  }

  const groups: ProjectGroup[] = [];
  for (const [key, list] of buckets) {
    if (key === STANDALONE) {
      groups.push(makeGroup(STANDALONE, "standalone", null, false, true, list));
      continue;
    }
    const meta = projectByCompose.get(key);
    groups.push(
      makeGroup(
        key,
        meta?.displayName ?? key,
        meta?.description ?? null,
        meta?.isPinned ?? false,
        false,
        list,
      ),
    );
  }

  return groups.sort((a, b) => {
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.composeProject.localeCompare(b.composeProject);
  });
}
