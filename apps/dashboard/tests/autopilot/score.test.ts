import { describe, it, expect } from "vitest";
import { computeScore, isDuplicate } from "../../../../scripts/autopilot/score.js";

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

  it("DB 마이그레이션 후보는 1.5 추가 페널티", () => {
    const protectedOnly = computeScore({ protectedPathTouch: true, dbMigration: false }, baseVerdicts);
    const both = computeScore({ protectedPathTouch: true, dbMigration: true }, baseVerdicts);
    expect(both).toBeLessThan(protectedOnly);
    expect(protectedOnly - both).toBeCloseTo(1.5, 5); // DB_MIGRATION_PENALTY
  });

  it("verdict 가 없으면 0 반환 (분모 0 방지)", () => {
    expect(computeScore({ protectedPathTouch: false, dbMigration: false }, [])).toBe(0);
  });
});

describe("isDuplicate", () => {
  const backlog = [{ dedupKey: "deps:next-16.3" }, { dedupKey: "ui:dashboard" }];

  it("backlog에 같은 dedupKey 있으면 true", () => {
    expect(isDuplicate("deps:next-16.3", backlog)).toBe(true);
  });

  it("backlog에 없는 dedupKey면 false", () => {
    expect(isDuplicate("feature:todo", backlog)).toBe(false);
  });

  it("빈 backlog면 false", () => {
    expect(isDuplicate("deps:next-16.3", [])).toBe(false);
  });
});
