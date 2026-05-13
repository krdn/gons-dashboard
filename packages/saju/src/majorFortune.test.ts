import { describe, expect, it } from "vitest";
import { computeMajorFortunes } from "./majorFortune";

describe("computeMajorFortunes", () => {
  it("G1: 1967-03-29 05:30 남자 양력 → 역행, 입대운 8세, 첫 대운 壬寅", () => {
    const result = computeMajorFortunes({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
    });
    expect(result).toHaveLength(10);
    expect(result[0].startAge).toBe(8);
    expect(result[0]).toMatchObject({ stem: "壬", branch: "寅" });
    expect(result[0].startYear).toBe(1974);
    // 역행이므로 다음은 辛丑
    expect(result[1]).toMatchObject({ stem: "辛", branch: "丑" });
  });

  it("hour=null이어도 정상 작동 (정오로 폴백)", () => {
    const result = computeMajorFortunes({
      birthDate: "1990-01-15",
      birthTime: null,
      calendar: "solar",
      gender: "female",
    });
    expect(result).toHaveLength(10);
  });
});
