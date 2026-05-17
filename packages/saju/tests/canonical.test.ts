import { describe, expect, it } from "vitest";
import { computeSajuChart } from "../src/computeSajuChart";
import fixture from "./fixtures/canonical-1967.json" with { type: "json" };

// 회귀 방지 골든 — 1967-03-29 05:30 KST 출생 차트 4주(四柱) 고정.
// fixture는 forward-compat 필드(timezone/longitudeDeg/elementBalance/daeun/gyeokguk)를 포함하지만,
// 현재 computeSajuChart 시그니처는 timezone/longitudeDeg를 받지 않으므로 (Task 1.1에서 도입 예정),
// 본 테스트는 4주 회귀만 검증한다.
describe("canonical chart — 1967-03-29 05:30 KST (壬辰 일주)", () => {
  it("4주 = 丁未 癸卯 壬辰 癸卯", () => {
    const chart = computeSajuChart({
      birthDate: fixture.input.birthDateLocal,
      birthTime: fixture.input.birthTimeLocal,
      calendar: fixture.input.calendar as "solar" | "lunar",
      gender: fixture.input.gender as "male" | "female",
      birthCity: null,
    });
    expect(chart.pillars.year).toEqual(fixture.expected.pillars.year);
    expect(chart.pillars.month).toEqual(fixture.expected.pillars.month);
    expect(chart.pillars.day).toEqual(fixture.expected.pillars.day);
    expect(chart.pillars.hour).toEqual(fixture.expected.pillars.hour);
  });
});
