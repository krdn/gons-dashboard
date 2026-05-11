// HostDashboard 의 정렬·필터 로직 — pure fn 으로 분리해 단위 테스트 가능.
//
// 정책:
//   - 검색어(query): 컨테이너 이름·statusText·port, 그룹 displayName·composeProject·description
//     모두에 부분 매칭.
//   - state filter:
//     - all: 모든 컨테이너
//     - running: state === "running" 만
//     - issues: exited / restarting / dead / paused
//   - 비어있는 그룹은 필터 후에는 숨김 (stale standalone 예외).
//   - 정렬: standalone 최하단 → 이슈 있는 그룹 상단 → pinned 우선 → 이름순.

import type { ProjectGroup } from "@/features/container-list/lib/groupByProject";

export type StateFilter = "all" | "running" | "issues";

const ISSUE_STATES = new Set(["exited", "restarting", "dead", "paused"]);

export function sortAndFilter(
  groups: ProjectGroup[],
  query: string,
  stateFilter: StateFilter,
): ProjectGroup[] {
  const q = query.trim().toLowerCase();

  const containerMatchesQuery = (
    c: ProjectGroup["containers"][number],
  ): boolean => {
    if (q === "") return true;
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.statusText.toLowerCase().includes(q)) return true;
    for (const port of c.ports) {
      if (port.hostPort != null && String(port.hostPort).includes(q)) return true;
    }
    return false;
  };

  const containerMatchesState = (
    c: ProjectGroup["containers"][number],
  ): boolean => {
    if (stateFilter === "all") return true;
    if (stateFilter === "running") return c.state === "running";
    if (stateFilter === "issues") return ISSUE_STATES.has(c.state);
    return true;
  };

  const groupMetaMatches = (g: ProjectGroup): boolean => {
    if (q === "") return true;
    if (g.displayName.toLowerCase().includes(q)) return true;
    if (g.composeProject.toLowerCase().includes(q)) return true;
    if (g.description?.toLowerCase().includes(q)) return true;
    return false;
  };

  const filtered: ProjectGroup[] = [];
  for (const g of groups) {
    const containers = g.containers.filter(
      (c) => containerMatchesQuery(c) && containerMatchesState(c),
    );

    // 검색어가 그룹 메타에 매칭되고 상태 필터가 'all' 이면 전체 컨테이너 표시.
    const useAllForGroupMatch =
      q !== "" && stateFilter === "all" && groupMetaMatches(g);

    const finalContainers = useAllForGroupMatch ? g.containers : containers;

    // 비어있는 그룹은 검색 시점에는 숨김. 단, isStale standalone 이고 필터 all 이면 표시.
    if (
      finalContainers.length === 0 &&
      !(q === "" && stateFilter === "all" && g.isStale && !g.isStandalone)
    ) {
      continue;
    }

    let running = 0;
    let warning = 0;
    for (const c of finalContainers) {
      if (c.state === "running") running++;
      if (ISSUE_STATES.has(c.state)) warning++;
    }

    filtered.push({
      ...g,
      containers: finalContainers,
      runningCount: running,
      totalCount: finalContainers.length,
      warningCount: warning,
    });
  }

  return filtered.sort((a, b) => {
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    const aIssue = a.warningCount > 0 ? 1 : 0;
    const bIssue = b.warningCount > 0 ? 1 : 0;
    if (aIssue !== bIssue) return bIssue - aIssue;
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, "ko");
  });
}
