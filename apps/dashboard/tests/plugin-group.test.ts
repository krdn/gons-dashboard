import { describe, it, expect } from "vitest";
import { groupPlugins } from "@/widgets/plugin-catalog/lib/groupPlugins";
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";

function mk(name: string, marketplace: string): PluginMeta {
  return {
    id: `${name}@${marketplace}`,
    name,
    marketplace,
    version: "1",
    description: "",
    author: "",
    homepage: "",
    keywords: [],
    enabled: true,
    resolved: true,
    counts: { skills: 0, agents: 0, commands: 0, hooks: false, mcp: false },
    components: { skills: [], agents: [], commands: [] },
  };
}

const marketplaces: Record<string, PluginMarketplaceMeta> = {
  one: { label: "one", count: 2 },
  two: { label: "two", count: 1 },
};

describe("groupPlugins", () => {
  it("marketplace 별로 묶고 count desc 정렬", () => {
    const groups = groupPlugins([mk("a", "one"), mk("b", "two"), mk("c", "one")], marketplaces);
    expect(groups.map((g) => g.slug)).toEqual(["one", "two"]);
    expect(groups[0].plugins.map((p) => p.name)).toEqual(["a", "c"]);
  });

  it("필터로 빈 그룹은 제외", () => {
    const groups = groupPlugins([mk("b", "two")], marketplaces);
    expect(groups.map((g) => g.slug)).toEqual(["two"]);
  });

  it("메타에 없는 marketplace 는 slug 자체를 label 로", () => {
    const groups = groupPlugins([mk("x", "ghost")], marketplaces);
    expect(groups[0].label).toBe("ghost");
  });
});
