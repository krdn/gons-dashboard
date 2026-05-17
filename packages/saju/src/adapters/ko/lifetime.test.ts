import { describe, expect, it } from "vitest";
import { buildLifetimeKo } from "./lifetime";
import { computeSajuChart } from "../../computeSajuChart";

describe("buildLifetimeKo", () => {
  it("1967-03-29 → school='ko', 격국=傷官格, schoolSpecific.system 포함", () => {
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

    // MINOR-3: 1967 fixture 실제 격국 매칭 (傷官格) — 빈 fallback 회귀 방지
    expect(frame.formatGyeokguk.name).toBe("傷官格");

    // MINOR-1: schoolSpecific.system 키 공통 필수
    expect((frame.schoolSpecific as { system?: string }).system).toContain("한국식 자평");

    // MINOR-6: yongshin 미적용 TODO cautions 명시
    expect(frame.cautions.length).toBeGreaterThan(0);
    expect(frame.cautions.some((c) => /용신|yongshin/.test(c))).toBe(true);
  });

  it("ctx 없이 호출 가능 (시그니처 통일)", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    // ctx 생략 호출이 타입·런타임 모두 통과해야 함
    const frame = buildLifetimeKo(chart);
    expect(frame.school).toBe("ko");
  });
});
