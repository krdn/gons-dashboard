import { describe, expect, it } from "vitest";
import { computeMajorFortunes } from "../majorFortune";
import { STEMS, BRANCHES } from "../hanja";

/**
 * 대운 회귀 검증 — 1967 fixture (입대운 8세 역행)
 *
 * 평생 운세 v0.1 회귀 보호:
 * - 양력 1967-03-29 05:30 남자 (丁未/癸卯/壬辰/癸卯, 일간 壬)
 * - 음년(丁未) 男 → 역행
 * - 입대운 8세, 月柱 癸卯 의 직전 간지 = 壬寅
 *
 * majorFortune.test.ts 의 G1 케이스를 확장:
 *   - 10개 사이클 전체에 걸친 역행 패턴 (간지 모두 retrograde)
 *   - startAge 가 10년 단위로 증가
 *   - startYear 가 startAge 와 일관 (1966 출생 + age 8 = 1974)
 */
describe("대운 회귀 — 1967 lifetime fixture (입대운 8세 역행)", () => {
  const fortunes = computeMajorFortunes({
    birthDate: "1967-03-29",
    birthTime: "05:30",
    calendar: "solar",
    gender: "male",
  });

  it("총 10개 대운 사이클 (평생 커버리지)", () => {
    expect(fortunes).toHaveLength(10);
  });

  it("입대운 8세 (첫 대운 startAge=8, startYear=1974)", () => {
    expect(fortunes[0]?.startAge).toBe(8);
    expect(fortunes[0]?.startYear).toBe(1974);
  });

  it("대운 startAge는 10년 단위 단조 증가 (8, 18, 28, ..., 98)", () => {
    const expectedAges = [8, 18, 28, 38, 48, 58, 68, 78, 88, 98];
    expect(fortunes.map((f) => f.startAge)).toEqual(expectedAges);
  });

  it("간(stem) 역행: 月干 癸 → 壬 → 辛 → 庚 → 己 → 戊 → 丁 → 丙 → 乙 → 甲 → 癸", () => {
    // STEMS = [甲, 乙, 丙, 丁, 戊, 己, 庚, 辛, 壬, 癸]
    // 역행: 月干 癸(index 9) 의 한 칸 전 = 壬(8), 그 다음 辛(7) ...
    const expectedStems = ["壬", "辛", "庚", "己", "戊", "丁", "丙", "乙", "甲", "癸"];
    expect(fortunes.map((f) => f.stem)).toEqual(expectedStems);

    // 각 stem 이 STEMS 배열에서 retrograde index 순서인지 검증
    for (let i = 0; i < fortunes.length - 1; i++) {
      const curr = STEMS.indexOf(fortunes[i]!.stem);
      const next = STEMS.indexOf(fortunes[i + 1]!.stem);
      const diff = (curr - next + 10) % 10;
      expect(diff).toBe(1); // 한 칸씩 retrograde
    }
  });

  it("지(branch) 역행: 月支 卯 → 寅 → 丑 → 子 → 亥 → 戌 → 酉 → 申 → 未 → 午 → 巳", () => {
    // BRANCHES = [子, 丑, 寅, 卯, 辰, 巳, 午, 未, 申, 酉, 戌, 亥]
    // 역행: 月支 卯(index 3) 의 한 칸 전 = 寅(2), 丑(1) ...
    const expectedBranches = ["寅", "丑", "子", "亥", "戌", "酉", "申", "未", "午", "巳"];
    expect(fortunes.map((f) => f.branch)).toEqual(expectedBranches);

    // 각 branch 가 BRANCHES 배열에서 retrograde index 순서인지 검증
    for (let i = 0; i < fortunes.length - 1; i++) {
      const curr = BRANCHES.indexOf(fortunes[i]!.branch);
      const next = BRANCHES.indexOf(fortunes[i + 1]!.branch);
      const diff = (curr - next + 12) % 12;
      expect(diff).toBe(1); // 한 칸씩 retrograde
    }
  });
});
