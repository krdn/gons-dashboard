import { describe, it, expect } from "vitest";
import { computeScore } from "../../../../scripts/autopilot/score.js";

const baseVerdicts = [
  { valueScore: 4, safetyScore: 4, feasibilityScore: 4, reasoning: "" },
  { valueScore: 4, safetyScore: 4, feasibilityScore: 4, reasoning: "" },
  { valueScore: 4, safetyScore: 4, feasibilityScore: 4, reasoning: "" },
];

describe("computeScore", () => {
  it("보호경로/마이그레이션 없는 후보는 페널티 없음", () => {
    const candidate = { protectedPathTouch: false, dbMigration: false };
    const score = computeScore(candidate, baseVerdicts);
    // value 4*0.4 + safety 4*0.35 + feasibility 4*0.25 = 4.0
    expect(score).toBeCloseTo(4.0, 5);
  });

  it("보호경로 후보는 큰 페널티", () => {
    const clean = computeScore({ protectedPathTouch: false, dbMigration: false }, baseVerdicts);
    const protectedC = computeScore({ protectedPathTouch: true, dbMigration: false }, baseVerdicts);
    expect(protectedC).toBeLessThan(clean);
    expect(clean - protectedC).toBeCloseTo(2.0, 5); // PROTECTED_PENALTY
  });

  it("DB 마이그레이션 후보는 추가 페널티", () => {
    const protectedOnly = computeScore({ protectedPathTouch: true, dbMigration: false }, baseVerdicts);
    const both = computeScore({ protectedPathTouch: true, dbMigration: true }, baseVerdicts);
    expect(both).toBeLessThan(protectedOnly);
  });

  it("verdict 가 없으면 0 반환 (분모 0 방지)", () => {
    expect(computeScore({ protectedPathTouch: false, dbMigration: false }, [])).toBe(0);
  });
});
