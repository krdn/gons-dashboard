import type { AgentMeta, AgentSource, AgentModel } from "@/entities/agent/client";

export type SourceFilter = AgentSource | "all";
export type ModelFilter = AgentModel | "all";

export function filterAgents(
  agents: AgentMeta[],
  query: string,
  source: SourceFilter = "all",
  model: ModelFilter = "all",
): AgentMeta[] {
  const q = query.trim().toLowerCase();
  return agents.filter((a) => {
    if (source !== "all" && a.source !== source) return false;
    if (model !== "all" && a.model !== model) return false;
    if (q === "") return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tools.some((t) => t.toLowerCase().includes(q))
    );
  });
}
