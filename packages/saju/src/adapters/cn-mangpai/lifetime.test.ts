import { describe, expect, it } from "vitest";
import { buildLifetimeCnMangpai } from "./lifetime";
import { computeSajuChart } from "../../computeSajuChart";
import { computeMajorFortunes } from "../../majorFortune";

describe("buildLifetimeCnMangpai", () => {
  it("1967-03-29 → school='cn-mangpai', schoolSpecific.eunggi 배열", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const daeun = computeMajorFortunes({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
    });
    const frame = buildLifetimeCnMangpai(chart, daeun);

    expect(frame.school).toBe("cn-mangpai");
    expect(Array.isArray((frame.schoolSpecific as { eunggi?: unknown[] }).eunggi)).toBe(true);
    expect(frame.cautions.length).toBeGreaterThan(0);
    expect(frame.formatGyeokguk.name.length).toBeGreaterThan(0);
  });
});
