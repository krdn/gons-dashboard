import { describe, expect, it } from "vitest";
import { computeProfileInputHash, computePairInputHash } from "./hash";

describe("computeProfileInputHash", () => {
  it("동일 입력 동일 hash", () => {
    const a = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: "05:30", birthCity: "Seoul",
    });
    const b = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: "05:30", birthCity: "Seoul",
    });
    expect(a).toBe(b);
  });

  it("birthTime null vs '' vs '05:30' 구분", () => {
    const h1 = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: null, birthCity: null,
    });
    const h2 = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: "05:30", birthCity: null,
    });
    expect(h1).not.toBe(h2);
  });

  it("gender 다르면 hash 다름", () => {
    const m = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: null, birthCity: null,
    });
    const f = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "female",
      birthTime: null, birthCity: null,
    });
    expect(m).not.toBe(f);
  });
});

describe("computePairInputHash", () => {
  it("순서 무관 (a,b) == (b,a)", () => {
    const h1 = computePairInputHash("hashA", "hashB");
    const h2 = computePairInputHash("hashB", "hashA");
    expect(h1).toBe(h2);
  });
});
