import { describe, expect, it } from "vitest";
import { buildLifetimeCnZiping } from "./lifetime";
import { computeSajuChart } from "../../computeSajuChart";

describe("buildLifetimeCnZiping", () => {
  it("1967-03-29 → school='cn-ziping', 격국=傷官格, schoolSpecific.system 포함", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeCnZiping(chart);

    expect(frame.school).toBe("cn-ziping");
    expect(frame.healthHints.length).toBeGreaterThan(0);
    expect(frame.formatGyeokguk.name.length).toBeGreaterThan(0);

    // MINOR-3: 1967 fixture 실제 격국 매칭 (傷官格)
    expect(frame.formatGyeokguk.name).toBe("傷官格");

    // MINOR-1: schoolSpecific.system 키 공통 필수
    const specific = frame.schoolSpecific as {
      system?: string;
      gyeokgukOrigin?: string;
      yongshinMethod?: string;
    };
    expect(specific.system).toBe("자평진전");
    expect(specific.gyeokgukOrigin).toBe("자평진전");
    expect(specific.yongshinMethod).toBe("억부");

    // MINOR-6: yongshinMethod 선언 vs yongshin undefined 모순을 cautions 에 명시
    expect(frame.cautions.length).toBeGreaterThan(0);
    expect(frame.cautions.some((c) => /yongshin|용신|미구현/.test(c))).toBe(true);
    expect(frame.yongshin).toBeUndefined();
  });

  it("ctx 없이 호출 가능 (시그니처 통일)", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeCnZiping(chart);
    expect(frame.school).toBe("cn-ziping");
  });
});
