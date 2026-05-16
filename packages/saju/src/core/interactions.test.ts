import { describe, expect, it } from "vitest";
import { computeInteractions } from "./interactions";

describe("computeInteractions — 합충형", () => {
  it("卯酉 충", () => {
    const i = computeInteractions({
      year:  { stem: "丁", branch: "未" },
      month: { stem: "癸", branch: "卯" },
      day:   { stem: "壬", branch: "辰" },
      hour:  { stem: "辛", branch: "酉" },
    });
    expect(i.chong.some(c => c.branches.includes("卯") && c.branches.includes("酉"))).toBe(true);
  });

  it("辰·酉 육합", () => {
    const i = computeInteractions({
      year:  { stem: "丁", branch: "辰" },
      month: { stem: "癸", branch: "酉" },
      day:   { stem: "壬", branch: "辰" },
      hour:  { stem: "癸", branch: "卯" },
    });
    expect(i.hap.some(h => h.branches.includes("辰") && h.branches.includes("酉"))).toBe(true);
  });

  it("辰辰 자형(自刑)", () => {
    const i = computeInteractions({
      year:  { stem: "壬", branch: "辰" },
      month: { stem: "甲", branch: "辰" },
      day:   { stem: "壬", branch: "辰" },
      hour:  { stem: "丙", branch: "午" },
    });
    expect(i.hyung.some(h => h.type === "자형" && h.branches[0] === "辰")).toBe(true);
  });
});
