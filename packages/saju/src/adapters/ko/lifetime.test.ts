import { describe, expect, it } from "vitest";
import { buildLifetimeKo } from "./lifetime";
import { computeSajuChart } from "../../computeSajuChart";

describe("buildLifetimeKo", () => {
  it("1967-03-29 → school='ko', healthHints 1개 이상", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeKo(chart);
    expect(frame.school).toBe("ko");
    expect(frame.healthHints.length).toBeGreaterThan(0);
    expect(frame.formatGyeokguk.name.length).toBeGreaterThan(0);
  });
});
