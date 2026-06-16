import { describe, it, expect } from "vitest";
import { binaryMetrics, macroF1, accuracy } from "./scorer";

describe("binaryMetrics", () => {
  it("완벽 분류 → precision=recall=f1=1", () => {
    const m = binaryMetrics([
      { predicted: true, expected: true },
      { predicted: true, expected: true },
      { predicted: false, expected: false },
    ]);
    expect(m.tp).toBe(2);
    expect(m.tn).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
  });

  it("FN 1건 → recall 하락, precision 유지", () => {
    const m = binaryMetrics([
      { predicted: true, expected: true },
      { predicted: false, expected: true },
    ]);
    expect(m.tp).toBe(1);
    expect(m.fn).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0.5);
    expect(m.f1).toBeCloseTo(0.6667, 3);
  });

  it("양성 예측 0건 → precision=0 (0 나눗셈 방어)", () => {
    const m = binaryMetrics([{ predicted: false, expected: true }]);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });
});

describe("macroF1", () => {
  it("2-class 완벽 분류 → macroF1=1", () => {
    // classes 인자는 평균 분모 — 등장하지 않은 클래스는 f1=0으로 처벌(sklearn labels= 시맨틱).
    // "완벽 분류=1"을 검증하려면 실제 등장한 클래스만 분모로 넘긴다.
    const f1 = macroF1(
      [
        { predicted: "money", expected: "money" },
        { predicted: "security", expected: "security" },
      ],
      ["money", "security"],
    );
    expect(f1).toBe(1);
  });

  it("한 클래스 전부 오분류 → macroF1 < 1", () => {
    const f1 = macroF1(
      [
        { predicted: "money", expected: "money" },
        { predicted: "money", expected: "security" },
      ],
      ["money", "security", "schedule", "notice", "none"],
    );
    expect(f1).toBeLessThan(1);
    expect(f1).toBeGreaterThan(0);
  });
});

describe("accuracy", () => {
  it("exact-match 비율 — 2/3 정답 → 0.6667", () => {
    const acc = accuracy([
      { predicted: "high", expected: "high" },
      { predicted: "med", expected: "med" },
      { predicted: "high", expected: "med" },
    ]);
    expect(acc).toBeCloseTo(0.6667, 3);
  });
});
