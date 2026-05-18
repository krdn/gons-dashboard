import { describe, expect, it } from "vitest";
import { buildYongshinKo } from "./yongshin";
import type { SajuChart } from "../../types";

// 본인 사주 — 1967-03-29 05:30, 壬辰 일주, 卯月 (春)
const canonical1967 = {
  pillars: {
    year: { stem: "丁", branch: "未" },
    month: { stem: "癸", branch: "卯" },
    day: { stem: "壬", branch: "辰" },
    hour: { stem: "癸", branch: "卯" },
  },
  majorFortunes: [],
} as unknown as SajuChart;

describe("buildYongshinKo — canonical 1967", () => {
  // Plan revise: plan 작성자의 "卯月이라 신강" 직관은 일간이 木일 때 한정.
  // 일간 壬(water) 기준으로는 卯(wood)·未(earth)·辰(earth)·丁(fire)이 모두
  // 설기/재성/관성 — drain 우세 → 신약. fixture 그대로 두고 expected 정정
  // (원칙 유지 / 직관 정정). 같은 fixture를 쓰는 Task 1.2 (CN자평)도 동일.
  it("일간 壬, 卯月 출생 → 신약 + 균형 조후, 인성 metal 보강", () => {
    const result = buildYongshinKo(canonical1967);
    expect(result.school).toBe("ko");
    expect(result.basisShenStrength).toBe("신약");
    expect(result.basisJohuMode).toBe("균형");
    // 신약 → 생부 오행(인성)이 용신. 壬水 일간 → 인성=metal.
    expect(result.primary).toBe("metal");
    expect(result.secondary).toBeUndefined();           // 균형 조후 → 보조 없음
    // 신약 기신: 식상(wood)·재성(fire)
    expect(result.gisin).toContain("wood");
    expect(result.gisin).toContain("fire");
  });
});
