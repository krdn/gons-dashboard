// sortAndFilter — HostDashboard 의 검색/필터/정렬 로직 단위 검증.
import { describe, it, expect } from "vitest";
import { sortAndFilter } from "@/widgets/host-dashboard/lib/sortAndFilter";
import type { ProjectGroup } from "@/features/container-list/lib/groupByProject";

type Container = ProjectGroup["containers"][number];

function makeContainer(over: Partial<Container> = {}): Container {
  return {
    id: "c-1",
    name: "container-1",
    state: "running",
    statusText: "Up 2 hours",
    ports: [],
    ...over,
  } as Container;
}

function makeGroup(over: Partial<ProjectGroup> = {}): ProjectGroup {
  const containers = over.containers ?? [makeContainer()];
  const runningCount = containers.filter((c) => c.state === "running").length;
  const warningCount = containers.filter((c) =>
    ["exited", "restarting", "dead", "paused"].includes(c.state),
  ).length;
  return {
    composeProject: "proj",
    displayName: "Project",
    description: undefined,
    category: undefined,
    url: undefined,
    isPinned: false,
    isHidden: false,
    isStandalone: false,
    isStale: false,
    containers,
    runningCount,
    totalCount: containers.length,
    warningCount,
    ...over,
  } as ProjectGroup;
}

describe("sortAndFilter", () => {
  it("query 빈 문자열 + filter=all → 모든 그룹·컨테이너 그대로", () => {
    const groups = [
      makeGroup({ composeProject: "a", displayName: "Alpha" }),
      makeGroup({ composeProject: "b", displayName: "Beta" }),
    ];
    const result = sortAndFilter(groups, "", "all");
    expect(result).toHaveLength(2);
  });

  it("query 컨테이너 이름 부분 매칭", () => {
    const groups = [
      makeGroup({
        composeProject: "p1",
        containers: [
          makeContainer({ name: "redis-cache" }),
          makeContainer({ id: "c-2", name: "postgres-main" }),
        ],
      }),
    ];
    const result = sortAndFilter(groups, "redis", "all");
    expect(result).toHaveLength(1);
    expect(result[0].containers).toHaveLength(1);
    expect(result[0].containers[0].name).toBe("redis-cache");
  });

  it("query 가 그룹 메타 매칭 + filter=all 이면 그룹 전체 컨테이너 표시", () => {
    const groups = [
      makeGroup({
        composeProject: "ai-news",
        displayName: "AI 뉴스",
        containers: [
          makeContainer({ name: "backend" }),
          makeContainer({ id: "c-2", name: "frontend" }),
        ],
      }),
    ];
    const result = sortAndFilter(groups, "ai-news", "all");
    expect(result).toHaveLength(1);
    expect(result[0].containers).toHaveLength(2); // 그룹 매칭 → 전체 표시
  });

  it("filter=running 은 state=running 컨테이너만", () => {
    const groups = [
      makeGroup({
        containers: [
          makeContainer({ state: "running" }),
          makeContainer({ id: "c-2", state: "exited" }),
          makeContainer({ id: "c-3", state: "restarting" }),
        ],
      }),
    ];
    const result = sortAndFilter(groups, "", "running");
    expect(result[0].containers).toHaveLength(1);
    expect(result[0].containers[0].state).toBe("running");
    expect(result[0].runningCount).toBe(1);
  });

  it("filter=issues 는 exited/restarting/dead/paused 만", () => {
    const groups = [
      makeGroup({
        containers: [
          makeContainer({ state: "running" }),
          makeContainer({ id: "c-2", state: "exited" }),
          makeContainer({ id: "c-3", state: "paused" }),
        ],
      }),
    ];
    const result = sortAndFilter(groups, "", "issues");
    expect(result[0].containers).toHaveLength(2);
    expect(result[0].warningCount).toBe(2);
  });

  it("정렬: standalone 그룹은 항상 최하단", () => {
    const groups = [
      makeGroup({ composeProject: "alpha", displayName: "Alpha", isStandalone: true }),
      makeGroup({ composeProject: "beta", displayName: "Beta" }),
    ];
    const result = sortAndFilter(groups, "", "all");
    expect(result[0].composeProject).toBe("beta");
    expect(result[1].composeProject).toBe("alpha");
    expect(result[1].isStandalone).toBe(true);
  });

  it("정렬: 이슈 있는 그룹이 이슈 없는 그룹보다 위", () => {
    const ok = makeGroup({
      composeProject: "ok-proj",
      displayName: "OK Project",
      containers: [makeContainer({ state: "running" })],
    });
    const bad = makeGroup({
      composeProject: "bad-proj",
      displayName: "Bad Project",
      containers: [makeContainer({ state: "exited" })],
    });
    const result = sortAndFilter([ok, bad], "", "all");
    expect(result[0].composeProject).toBe("bad-proj");
    expect(result[1].composeProject).toBe("ok-proj");
  });

  it("정렬: pinned 가 unpinned 보다 위 (같은 이슈 여부)", () => {
    const groups = [
      makeGroup({ composeProject: "u", displayName: "Unpinned" }),
      makeGroup({ composeProject: "p", displayName: "Pinned", isPinned: true }),
    ];
    const result = sortAndFilter(groups, "", "all");
    expect(result[0].composeProject).toBe("p");
  });

  it("비어있는 그룹은 필터 후 숨김 (stale 예외 X)", () => {
    const groups = [
      makeGroup({
        composeProject: "empty",
        containers: [makeContainer({ state: "running" })],
      }),
    ];
    const result = sortAndFilter(groups, "", "issues");
    expect(result).toHaveLength(0); // running 만 있어서 issues 필터에서 0건 → 그룹 숨김
  });
});
