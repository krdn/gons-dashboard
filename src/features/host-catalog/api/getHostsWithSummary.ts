import "server-only";
import { getHosts, type Host } from "@/entities/host";
import { listContainers } from "@/entities/container";
import {
  getProjects,
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
        const [containers, projects] = await Promise.all([
          listContainers({ hostId: host.id, dockerContext: host.dockerContext }),
          getProjects(host.id),
        ]);
        const knownComposeKeys = new Set(projects.map((p) => p.composeProject));
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
              upsertProjectFromContainer({ hostId: host.id, composeProject }),
            ),
          );
          upsertedProjects = [...projects, ...created];
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
