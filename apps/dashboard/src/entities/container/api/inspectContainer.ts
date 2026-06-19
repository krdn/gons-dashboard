import "server-only";
import {
  inspectContainer as dockerInspect,
  listContainers as dockerList,
} from "@/shared/lib/docker";
import type { ContainerInspect } from "../model/types";

type InspectInput = {
  hostId: string;
  dockerContext: string;
  containerId: string;
};

export async function inspectContainer(input: InspectInput): Promise<ContainerInspect> {
  const all = await dockerList({
    context: input.dockerContext,
    hostId: input.hostId,
  });
  const base = all.find((c) => c.id === input.containerId);
  if (!base) {
    throw new Error(`container not found: ${input.containerId}`);
  }
  return dockerInspect(input.dockerContext, input.containerId, base);
}
