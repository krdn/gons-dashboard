import { describe, expect, it } from "vitest";
import { buildLifetimeJp } from "./lifetime";
import { computeSajuChart } from "../../computeSajuChart";

describe("buildLifetimeJp", () => {
  it("1967-03-29 → school='jp', 진태양시 보정 정확도 표기 + yongshin 의도적 omit", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeJp(chart, {
      trueSolar: { trueSolarMinutesOffset: -32, hourKnown: true },
    });

    expect(frame.school).toBe("jp");
    const specific = frame.schoolSpecific as { accuracy?: string; system?: string };
    expect(specific.accuracy).toMatch(/보정/);
    // MINOR-3: 보정 분 숫자값 정확히 포함 확인 (-32)
    expect(specific.accuracy).toMatch(/-32/);
    expect(specific.system).toContain("추명학");

    // 일본 추명학은 용신 개념 미사용 — undefined 가 의도적 omit (extendedTypes.ts 명시)
    expect(frame.yongshin).toBeUndefined();
    // cautions 는 학파 다양성 1건만 — yongshin 미적용 TODO 는 jp 에 추가하지 않는다 (cn-mangpai 와의 차이)
    expect(frame.cautions.length).toBe(1);
    expect(frame.cautions[0]).toMatch(/학파/);
    expect(frame.formatGyeokguk.name.length).toBeGreaterThan(0);
  });

  it("hourKnown=false → 시주 미상 정확도 ⚠ 표기", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: null,
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeJp(chart, {
      trueSolar: { trueSolarMinutesOffset: 0, hourKnown: false },
    });

    expect((frame.schoolSpecific as { accuracy?: string }).accuracy).toMatch(/미상|⚠/);
  });

  it("ctx 미지정 → 진태양시 미상 폴백", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    const frame = buildLifetimeJp(chart);
    expect((frame.schoolSpecific as { accuracy?: string }).accuracy).toMatch(/진태양시 미상|⚠/);
  });
});
