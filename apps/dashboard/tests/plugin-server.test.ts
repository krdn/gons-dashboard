import { describe, it, expect } from "vitest";
import { getPlugins, getPluginMarketplaces } from "@/entities/plugin/server";

describe("getPlugins", () => {
  it("catalog.json 을 배열로 반환한다", () => {
    const plugins = getPlugins();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThan(0);
  });

  it("각 plugin 이 필수 필드를 갖는다", () => {
    for (const p of getPlugins()) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.enabled).toBe("boolean");
      expect(typeof p.counts.skills).toBe("number");
    }
  });

  it("marketplaces 메타의 count 합이 plugin 수와 같다", () => {
    const total = Object.values(getPluginMarketplaces()).reduce((s, m) => s + m.count, 0);
    expect(total).toBe(getPlugins().length);
  });
});
