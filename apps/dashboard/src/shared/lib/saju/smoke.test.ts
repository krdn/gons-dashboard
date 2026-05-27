import { describe, expect, it } from "vitest";
import { computeSajuChart } from "@krdn/saju";

describe("@krdn/saju 워크스페이스 import smoke", () => {
  it("dashboard에서 호출 가능 + G1 결과", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    expect(chart.pillars.day.stem).toBe("壬");
  });
});
