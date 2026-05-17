import "server-only";
import { getHosts, type Host } from "@/entities/host";
import { listContainers } from "@/entities/container/server";
import {
  getProjects,
  getProjectComposeKeys,
  syncMissingProjects,
} from "@/entities/project/server";
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
        const created = await syncMissingProjects({
          hostId: host.id,
          hostName: host.name,
          observed: containers
            .map((c) => c.composeProject)
            .filter((k): k is string => k != null),
          knownComposeKeys: allComposeKeys,
        });
        const upsertedProjects = [...projects, ...created];
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
