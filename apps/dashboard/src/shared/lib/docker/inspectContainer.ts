import "server-only";
import { z } from "zod";
import { runDocker } from "./runDocker";
import type { ContainerSummary } from "./parseContainer";
import { maskEnv } from "./maskEnv";

export type ContainerInspect = ContainerSummary & {
  restartCount: number;
  imageDigest: string | null;
  mounts: Array<{ source: string; target: string; type: string }>;
  envMasked: Array<{ key: string; value: string | "***" }>;
  labels: Record<string, string>;
};

const InspectMountSchema = z.object({
  Type: z.string(),
  Source: z.string(),
  Destination: z.string(),
});

const InspectShape = z.object({
  Id: z.string(),
  Name: z.string(),
  State: z.object({
    Status: z.string(),
    Restarting: z.boolean().optional(),
  }),
  RestartCount: z.number().int().nonnegative(),
  Image: z.string(),
  Config: z.object({
    Image: z.string(),
    Env: z.array(z.string()).default([]),
    Labels: z.record(z.string(), z.string()).nullable().default({}),
  }),
  Mounts: z.array(InspectMountSchema).default([]),
});

export async function inspectContainer(
  context: string,
  containerId: string,
  base: ContainerSummary,
): Promise<ContainerInspect> {
  const stdout = await runDocker(context, ["inspect", containerId]);
  const arr = JSON.parse(stdout);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("docker inspect returned empty array");
  }
  const parsed = InspectShape.parse(arr[0]);
  const labels = parsed.Config.Labels ?? {};
  const mounts = parsed.Mounts.map((m) => ({
    source: m.Source,
    target: m.Destination,
    type: m.Type,
  }));
  const envMasked = parsed.Config.Env.map((line) => {
    const eq = line.indexOf("=");
    const key = eq > 0 ? line.slice(0, eq) : line;
    const value = eq > 0 ? line.slice(eq + 1) : "";
    return { key, value: maskEnv(key) ? "***" : value };
  });
  return {
    ...base,
    restartCount: parsed.RestartCount,
    imageDigest: parsed.Image.startsWith("sha256:") ? parsed.Image : null,
    mounts,
    envMasked,
    labels,
  };
}
