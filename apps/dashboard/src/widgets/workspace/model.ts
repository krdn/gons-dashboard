import type { HostSummary } from "@/features/host-catalog";
export type ProjectStatus = "running" | "attention" | "unknown";
export type WorkspaceProject = {
  id: string;
  name: string;
  key: string;
  host: string;
  description: string | null;
  category: string | null;
  url: string | null;
  pinned: boolean;
  running: number;
  total: number;
  status: ProjectStatus;
  fetchedAt: string;
};
export function projectStatus(
  group: HostSummary["groups"][number],
): ProjectStatus {
  if (group.totalCount === 0 || group.isStale) return "unknown";
  if (group.warningCount > 0 || group.runningCount < group.totalCount)
    return "attention";
  return "running";
}
export function safeProjectUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function workspaceProjects(
  summaries: HostSummary[],
): WorkspaceProject[] {
  return summaries
    .flatMap((summary) =>
      summary.groups.map((group) => ({
        id: `${summary.host.id}:${group.composeProject}`,
        name: group.displayName,
        key: group.composeProject,
        host: summary.host.name,
        description: group.description,
        category: group.category,
        url: safeProjectUrl(group.url),
        pinned: group.isPinned,
        running: group.runningCount,
        total: group.totalCount,
        status: projectStatus(group),
        fetchedAt: summary.fetchedAt,
      })),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name),
    );
}
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  running: "컨테이너 실행 중",
  attention: "확인 필요",
  unknown: "컨테이너 미관측",
};
