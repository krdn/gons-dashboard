import "server-only";
import { getHosts, type Host } from "@/entities/host";
import { listContainers } from "@/entities/container";
import {
  getProjects,
  getProjectComposeKeys,
  upsertProjectFromContainer,
  type Project,
} from "@/entities/project";
import { groupByProject, type ProjectGroup } from "@/features/container-list";

export type HostSummary = {
  host: Host;
  groups: ProjectGroup[];
  daemonOk: boolean;
  errorMessage: string | null;
  fetchedAt: string;
};

export async function getHostsWithSummary(): Promise<HostSummary[]> {
  const hosts = await getHosts();
  const summaries = await Promise.all(
    hosts.map(async (host): Promise<HostSummary> => {
      try {
        const [containers, projects, allComposeKeys] = await Promise.all([
          listContainers({ hostId: host.id, dockerContext: host.dockerContext }),
          getProjects(host.id),
          getProjectComposeKeys(host.id),
        ]);
        // dedup은 hidden 포함 전체 key set으로 — hidden project가 매번 unknown으로
        // 분류돼 upsert가 반복되는 것을 막는다.
        const knownComposeKeys = new Set(allComposeKeys);
        const unknown = Array.from(
          new Set(
            containers
              .map((c) => c.composeProject)
              .filter((k): k is string => k != null && !knownComposeKeys.has(k)),
          ),
        );
        let upsertedProjects: Project[] = projects;
        if (unknown.length > 0) {
          const created = await Promise.all(
            unknown.map((composeProject) =>
              upsertProjectFromContainer({
                hostId: host.id,
                hostName: host.name,
                composeProject,
              }),
            ),
          );
          // 화이트리스트 외 compose는 upsert가 null 반환 → 새 project row 생성 안 함
          // (Task 6에서 groupByProject가 standalone 그룹으로 합류 처리)
          const createdNonNull = created.filter((p): p is Project => p !== null);
          upsertedProjects = [...projects, ...createdNonNull];
        }
        return {
          host,
          groups: groupByProject(containers, upsertedProjects),
          daemonOk: true,
          errorMessage: null,
          fetchedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          host,
          groups: [],
          daemonOk: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          fetchedAt: new Date().toISOString(),
        };
      }
    }),
  );
  return summaries;
}
