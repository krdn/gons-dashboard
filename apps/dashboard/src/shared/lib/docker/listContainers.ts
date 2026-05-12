import "server-only";
import { runDocker } from "./runDocker";
import { parseContainer, type ContainerSummary } from "./parseContainer";

export type ListContainersInput = {
  context: string;
  hostId: string;
};

export async function listContainers(
  input: ListContainersInput,
): Promise<ContainerSummary[]> {
  const stdout = await runDocker(input.context, [
    "container",
    "ls",
    "--all",
    "--no-trunc",
    "--format",
    "{{json .}}",
  ]);
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const out: ContainerSummary[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line);
      out.push(parseContainer(raw, input.hostId));
    } catch (err) {
      console.warn("[docker.listContainers] skipped malformed line", {
        line: line.slice(0, 200),
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
