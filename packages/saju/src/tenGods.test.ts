import { describe, expect, it } from "vitest";
import { computeTenGods } from "./tenGods";

describe("computeTenGods", () => {
  it("G1: 일간 壬水 기준 — 연주 丁未, 월주 癸卯, 일주 壬辰, 시주 癸卯", () => {
    const result = computeTenGods({
      year:  { stem: "丁", branch: "未" },
      month: { stem: "癸", branch: "卯" },
      day:   { stem: "壬", branch: "辰" },
      hour:  { stem: "癸", branch: "卯" },
    });
    // 壬(陽水) vs 丁(陰火) — 水克火, 일간이 극, 음양 다름 → 正財
    expect(result.yearStem).toBe("正財");
    // 壬 vs 未(본기 己, 陰土) — 土克水, 일간을 극, 음양 다름 → 正官
    expect(result.yearBranch).toBe("正官");
    // 壬 vs 癸(陰水) — 같은 오행, 음양 다름 → 劫財
    expect(result.monthStem).toBe("劫財");
    // 壬 vs 卯(본기 乙, 陰木) — 水生木, 일간이 생, 음양 다름 → 傷官
    expect(result.monthBranch).toBe("傷官");
    // 壬 vs 辰(본기 戊, 陽土) — 土克水, 일간을 극, 음양 같음 → 偏官
    expect(result.dayBranch).toBe("偏官");
    expect(result.hourStem).toBe("劫財");
    expect(result.hourBranch).toBe("傷官");
  });

  it("일간이 자기 자신은 십신 없음 (dayStem 필드 부재)", () => {
    const result = computeTenGods({
      year:  { stem: "甲", branch: "子" },
      month: { stem: "乙", branch: "丑" },
      day:   { stem: "丙", branch: "寅" },
      hour:  null,
    });
    expect(result.hourStem).toBeNull();
    expect(result.hourBranch).toBeNull();
    // @ts-expect-error — dayStem은 TenGodAssignment에 없어야 함
    expect(result.dayStem).toBeUndefined();
  });
});
