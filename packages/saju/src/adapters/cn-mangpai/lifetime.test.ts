import { describe, expect, it } from "vitest";
import { buildLifetimeCnMangpai } from "./lifetime";
import { computeSajuChart } from "../../computeSajuChart";
import { computeMajorFortunes } from "../../majorFortune";
import type { SajuChart, MajorFortune } from "../../types";

describe("buildLifetimeCnMangpai", () => {
  it("1967-03-29 → school='cn-mangpai', schoolSpecific.eunggi 배열 + invariant", () => {
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
    const frame = buildLifetimeCnMangpai(chart, { daeun });

    expect(frame.school).toBe("cn-mangpai");
    const eunggi = (frame.schoolSpecific as { eunggi?: unknown[] }).eunggi;
    expect(Array.isArray(eunggi)).toBe(true);
    expect(frame.cautions.length).toBeGreaterThan(0);
    expect(frame.formatGyeokguk.name.length).toBeGreaterThan(0);

    // MINOR-3: daeunHighlights.length === eunggi.length invariant
    expect(frame.daeunHighlights.length).toBe(eunggi!.length);

    // MINOR-3: cautions 에 v0.1 TODO (yongshin 미적용) 문자열 포함 확인
    expect(frame.cautions.some((c) => /v0\.1.*용신|용신.*v0\.1|yongshin/.test(c))).toBe(true);

    // MINOR-1: schoolSpecific.system 키 공통 필수
    expect((frame.schoolSpecific as { system?: string }).system).toContain("단건업");
  });

  it("ctx 미지정 시 daeun 빈 배열로 폴백 (옵셔널 처리)", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeCnMangpai(chart);
    const eunggi = (frame.schoolSpecific as { eunggi?: unknown[] }).eunggi;
    expect(eunggi).toEqual([]);
    expect(frame.daeunHighlights).toEqual([]);
  });

  it("IMPORTANT-1: 일지=년지 충돌 시 day/year 두 entry 모두 생성", () => {
    // 일지·년지 모두 '卯' 인 인공 fixture. computeSajuChart 가 자연 생성하지 않으므로
    // SajuChart 타입을 만족하는 mock 객체로 직접 작성.
    const mockChart: SajuChart = {
      pillars: {
        year: { stem: "丁", branch: "卯" },
        month: { stem: "癸", branch: "卯" },
        day: { stem: "甲", branch: "卯" }, // 일지 == 년지 (둘 다 卯)
        hour: { stem: "乙", branch: "丑" },
      },
      elements: { wood: 4, fire: 1, earth: 1, metal: 0, water: 2 },
      tenGods: {
        yearStem: "正官",
        yearBranch: "劫財",
        monthStem: "正印",
        monthBranch: "劫財",
        dayBranch: "劫財",
        hourStem: "劫財",
        hourBranch: "正財",
      },
      strength: "균형",
      pattern: "傷官格",
      yongSin: ["fire"],
      giSin: ["water"],
      majorFortunes: [],
      inputHash: "mock-day-eq-year",
    };

    // 대운 1개에 branch='卯' (일지=년지와 일치) → day + year 두 entry 발생해야 함
    const daeun: MajorFortune[] = [
      { startAge: 10, startYear: 1977, stem: "甲", branch: "卯" },
      { startAge: 20, startYear: 1987, stem: "乙", branch: "巳" }, // 일치 안 함
    ];

    const frame = buildLifetimeCnMangpai(mockChart, { daeun });
    const eunggi = (frame.schoolSpecific as { eunggi: Array<{ target: string; startAge: number }> }).eunggi;

    // 첫 대운(卯) 에서 day + year 동시 응기 → 2건. 두 번째 대운(巳) 은 무관 → 0건.
    expect(eunggi.length).toBe(2);
    expect(eunggi.filter((e) => e.target === "day").length).toBe(1);
    expect(eunggi.filter((e) => e.target === "year").length).toBe(1);
    expect(eunggi.every((e) => e.startAge === 10)).toBe(true);

    // daeunHighlights 도 동일하게 2건
    expect(frame.daeunHighlights.length).toBe(2);
    const pillars = frame.daeunHighlights.map((h) => h.pillar).sort();
    expect(pillars).toEqual(["day", "year"]);
  });

  it("정상 케이스 (일지 != 년지) — branch 매칭 시 단일 entry", () => {
    const mockChart: SajuChart = {
      pillars: {
        year: { stem: "丁", branch: "未" }, // 년지 未
        month: { stem: "癸", branch: "卯" },
        day: { stem: "甲", branch: "辰" }, // 일지 辰 — 년지와 다름
        hour: { stem: "乙", branch: "丑" },
      },
      elements: { wood: 2, fire: 1, earth: 3, metal: 0, water: 1 },
      tenGods: {
        yearStem: "正官",
        yearBranch: "劫財",
        monthStem: "正印",
        monthBranch: "劫財",
        dayBranch: "劫財",
        hourStem: "劫財",
        hourBranch: "正財",
      },
      strength: "균형",
      pattern: "正官格",
      yongSin: ["fire"],
      giSin: ["water"],
      majorFortunes: [],
      inputHash: "mock-normal-case",
    };

    const daeun: MajorFortune[] = [
      { startAge: 10, startYear: 1977, stem: "甲", branch: "辰" }, // 일지 일치
      { startAge: 20, startYear: 1987, stem: "乙", branch: "未" }, // 년지 일치
      { startAge: 30, startYear: 1997, stem: "丙", branch: "巳" }, // 무관
    ];

    const frame = buildLifetimeCnMangpai(mockChart, { daeun });
    const eunggi = (frame.schoolSpecific as { eunggi: Array<{ target: string; startAge: number }> }).eunggi;

    expect(eunggi.length).toBe(2);
    expect(eunggi.find((e) => e.startAge === 10)?.target).toBe("day");
    expect(eunggi.find((e) => e.startAge === 20)?.target).toBe("year");
  });
});
