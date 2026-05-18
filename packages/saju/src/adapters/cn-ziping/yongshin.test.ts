import { describe, expect, it } from "vitest";
import { buildYongshinCnZiping } from "./yongshin";
import type { SajuChart } from "../../types";

// 본인 사주 — 1967-03-29 05:30, 壬辰 일주, 卯月 (春)
// Plan revise: KO yongshin.test 와 동일하게 신약 expected (직관 정정).
const canonical1967 = {
  pillars: {
    year: { stem: "丁", branch: "未" },
    month: { stem: "癸", branch: "卯" },
    day: { stem: "壬", branch: "辰" },
    hour: { stem: "癸", branch: "卯" },
  },
  majorFortunes: [],
} as unknown as SajuChart;

describe("buildYongshinCnZiping — canonical 1967", () => {
  it("억부 단일 — 일간 壬 신약 → 인성 metal primary", () => {
    const r = buildYongshinCnZiping(canonical1967);
    expect(r.school).toBe("cn-ziping");
    expect(r.basisShenStrength).toBe("신약");
    // 신약 → 생부 오행(인성)이 primary. 壬水 일간 → 인성=metal.
    expect(r.primary).toBe("metal");
    // canonical fixture roleCount: 관성(未/辰=2), 인성(metal=0).
    // 관인상생 조건(관성≥1 + 인성≥1) 미달 → "기타".
    expect(r.structureHint).toBe("기타");
    expect(r.gisin).toContain("wood");
    expect(r.gisin).toContain("fire");
  });
});
