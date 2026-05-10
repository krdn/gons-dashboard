import "server-only";
import { listContainers as dockerList } from "@/shared/lib/docker";
import type { ContainerSummary } from "../model/types";

export type ListInput = {
  hostId: string;
  dockerContext: string;
};

export async function listContainers(input: ListInput): Promise<ContainerSummary[]> {
  return dockerList({ context: input.dockerContext, hostId: input.hostId });
}
