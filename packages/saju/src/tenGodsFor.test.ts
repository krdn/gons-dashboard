import { describe, expect, it } from "vitest";
import { tenGodsForPillar } from "./tenGodsFor";

describe("tenGodsForPillar", () => {
  it("TG1: 壬日간 vs 丙午 → 偏財 / 正財", () => {
    // 壬(陽水) vs 丙(陽火): 水克火, 음양 같음 → 偏財
    // 壬 vs 午(본기 丁陰火): 水克火, 음양 다름 → 正財
    expect(tenGodsForPillar("壬", { stem: "丙", branch: "午" })).toEqual({
      stemTenGod: "偏財",
      branchTenGod: "正財",
    });
  });

  it("壬日간 vs 戊子 (D1 2026-05-14) → 偏官 / 劫財", () => {
    // 壬(陽水) vs 戊(陽土): 土克水, 음양 같음 → 偏官
    // 壬 vs 子(본기 癸陰水): 같은 오행, 음양 다름 → 劫財
    expect(tenGodsForPillar("壬", { stem: "戊", branch: "子" })).toEqual({
      stemTenGod: "偏官",
      branchTenGod: "劫財",
    });
  });
});
