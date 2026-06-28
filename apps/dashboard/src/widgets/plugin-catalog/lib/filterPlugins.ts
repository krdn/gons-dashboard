import type { PluginMeta, PluginStatus } from "@/entities/plugin/client";

export type MarketplaceFilter = string | "all";
export type StatusFilter = PluginStatus | "all";

/** resolved=false 가 enabled 보다 우선 — 경로 없으면 무조건 missing. */
export function pluginStatus(p: PluginMeta): PluginStatus {
  if (!p.resolved) return "missing";
  return p.enabled ? "active" : "dormant";
}

export function filterPlugins(
  plugins: PluginMeta[],
  query: string,
  marketplace: MarketplaceFilter,
  status: StatusFilter,
): PluginMeta[] {
  const q = query.trim().toLowerCase();
  return plugins.filter((p) => {
    if (marketplace !== "all" && p.marketplace !== marketplace) return false;
    if (status !== "all" && pluginStatus(p) !== status) return false;
    if (q === "") return true;
    return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  });
}
