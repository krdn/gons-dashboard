import { describe, it, expect } from "vitest";
import { filterPlugins, pluginStatus } from "@/widgets/plugin-catalog/lib/filterPlugins";
import type { PluginMeta } from "@/entities/plugin/client";

function mk(over: Partial<PluginMeta>): PluginMeta {
  return {
    id: "x@mk",
    name: "x",
    marketplace: "mk",
    version: "1",
    description: "",
    author: "",
    homepage: "",
    keywords: [],
    enabled: true,
    resolved: true,
    counts: { skills: 0, agents: 0, commands: 0, hooks: false, mcp: false },
    components: { skills: [], agents: [], commands: [] },
    ...over,
  };
}

const plugins: PluginMeta[] = [
  mk({ id: "a@one", name: "alpha", marketplace: "one", enabled: true, resolved: true, description: "first tool" }),
  mk({ id: "b@two", name: "beta", marketplace: "two", enabled: false, resolved: true }),
  mk({ id: "c@one", name: "gamma", marketplace: "one", enabled: true, resolved: false }),
];

describe("pluginStatus", () => {
  it("resolved=false → missing (enabled 무관)", () => {
    expect(pluginStatus(plugins[2])).toBe("missing");
  });
  it("enabled=true & resolved → active", () => {
    expect(pluginStatus(plugins[0])).toBe("active");
  });
  it("enabled=false & resolved → dormant", () => {
    expect(pluginStatus(plugins[1])).toBe("dormant");
  });
});

describe("filterPlugins 직교성", () => {
  it("marketplace 필터", () => {
    const r = filterPlugins(plugins, "", "one", "all");
    expect(r.map((p) => p.name).sort()).toEqual(["alpha", "gamma"]);
  });
  it("status 필터 (dormant)", () => {
    const r = filterPlugins(plugins, "", "all", "dormant");
    expect(r.map((p) => p.name)).toEqual(["beta"]);
  });
  it("status 필터 (missing)", () => {
    const r = filterPlugins(plugins, "", "all", "missing");
    expect(r.map((p) => p.name)).toEqual(["gamma"]);
  });
  it("검색 + marketplace 교차", () => {
    const r = filterPlugins(plugins, "first", "one", "all");
    expect(r.map((p) => p.name)).toEqual(["alpha"]);
  });
  it("빈 쿼리는 전체 통과", () => {
    expect(filterPlugins(plugins, "", "all", "all")).toHaveLength(3);
  });
});
