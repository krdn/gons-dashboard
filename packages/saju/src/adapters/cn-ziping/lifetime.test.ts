import { describe, expect, it } from "vitest";
import { buildLifetimeCnZiping } from "./lifetime";
import { computeSajuChart } from "../../computeSajuChart";

describe("buildLifetimeCnZiping", () => {
  it("1967-03-29 → school='cn-ziping', healthHints 1개 이상", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeCnZiping(chart);
    expect(frame.school).toBe("cn-ziping");
    expect(frame.healthHints.length).toBeGreaterThan(0);
    expect(frame.formatGyeokguk.name.length).toBeGreaterThan(0);
  });
});
