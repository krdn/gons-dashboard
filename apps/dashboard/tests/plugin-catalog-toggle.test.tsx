// @vitest-environment jsdom
// PluginCatalog 접기/펼치기 + status 필터 — 핵심 동작을 결정적으로 검증.
// 브라우저 인터랙션의 flakiness 없이 회귀를 잡는다 (skill 카탈로그 교훈).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PluginCatalog } from "@/widgets/plugin-catalog/ui/PluginCatalog";
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";

afterEach(cleanup);

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
    counts: { skills: 1, agents: 0, commands: 0, hooks: 0, mcp: false },
    components: { skills: ["s"], agents: [], commands: [] },
  };
}

const plugins = [mk("alpha", "one"), mk("beta", "two")];
const marketplaces: Record<string, PluginMarketplaceMeta> = {
  one: { label: "one", count: 1 },
  two: { label: "two", count: 1 },
};

describe("PluginCatalog 토글", () => {
  it("그룹 헤더 클릭 시 해당 그룹 plugin 이 사라졌다 나타난다", () => {
    render(<PluginCatalog plugins={plugins} marketplaces={marketplaces} />);
    expect(screen.getByText("alpha")).toBeTruthy();
    // "one" 그룹 헤더 토글 (aria-expanded 버튼). marketplace 칩과 구분 위해 expanded 버튼만 선택.
    const oneHeader = screen
      .getAllByRole("button", { expanded: true })
      .find((b) => b.textContent?.includes("one"));
    expect(oneHeader).toBeTruthy();
    fireEvent.click(oneHeader!);
    expect(screen.queryByText("alpha")).toBeNull();
    fireEvent.click(oneHeader!);
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("status 필터 휴면 선택 시 active plugin 숨김", () => {
    render(<PluginCatalog plugins={plugins} marketplaces={marketplaces} />);
    fireEvent.click(screen.getByRole("button", { name: "휴면" }));
    expect(screen.queryByText("alpha")).toBeNull();
  });
});
