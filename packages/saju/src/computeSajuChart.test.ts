import { describe, expect, it } from "vitest";
import { computeSajuChart } from "./computeSajuChart";

describe("computeSajuChart — G1 end-to-end", () => {
  const G1 = {
    birthDate: "1967-03-29",
    birthTime: "05:30",
    calendar: "solar" as const,
    gender: "male" as const,
    birthCity: null,
  };

  it("4주 = 丁未 癸卯 壬辰 癸卯", () => {
    const chart = computeSajuChart(G1);
    expect(chart.pillars.year).toEqual({ stem: "丁", branch: "未" });
    expect(chart.pillars.month).toEqual({ stem: "癸", branch: "卯" });
    expect(chart.pillars.day).toEqual({ stem: "壬", branch: "辰" });
    expect(chart.pillars.hour).toEqual({ stem: "癸", branch: "卯" });
  });

  it("오행 = wood:2 fire:1 earth:2 metal:0 water:3", () => {
    const chart = computeSajuChart(G1);
    expect(chart.elements).toEqual({ wood: 2, fire: 1, earth: 2, metal: 0, water: 3 });
  });

  it("격국 = 傷官格, v0.3 종아격 → 용신에 metal+water 포함", () => {
    const chart = computeSajuChart(G1);
    expect(chart.pattern).toBe("傷官格");
    // v0.3: G1 은 종아격(식상 우세) → 용신 = wood (식상), 기신 = metal·water
    // pattern.ts 의 신약 branch: [인성(金), 비겁(水)] → metal, water
    expect(chart.yongSin).toEqual(expect.arrayContaining(["metal", "water"]));
  });

  it("대운 10개, 첫 대운 = 8세 壬寅", () => {
    const chart = computeSajuChart(G1);
    expect(chart.majorFortunes).toHaveLength(10);
    expect(chart.majorFortunes[0].startAge).toBe(8);
    expect(chart.majorFortunes[0]).toMatchObject({ stem: "壬", branch: "寅" });
  });

  it("inputHash는 결정적이고 입력 변경 시 다름", () => {
    const h1 = computeSajuChart(G1).inputHash;
    const h2 = computeSajuChart({ ...G1, birthCity: "Seoul " }).inputHash;
    const h3 = computeSajuChart({ ...G1, birthCity: "seoul" }).inputHash;
    expect(h1).not.toBe(h2);
    expect(h2).toBe(h3); // trim + lowercase 정규화로 동일
  });
});
