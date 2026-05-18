import { describe, expect, it } from "vitest";
import { buildYongshinCnMangpai } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  pillars: {
    year: { stem: "丁", branch: "未" },
    month: { stem: "癸", branch: "卯" },
    day: { stem: "壬", branch: "辰" },
    hour: { stem: "癸", branch: "卯" },
  },
  majorFortunes: [],
} as unknown as SajuChart;

describe("buildYongshinCnMangpai — canonical 1967", () => {
  it("壬日 卯月 — 식상 木 용신 + 응기 hint (同氣)", () => {
    const r = buildYongshinCnMangpai(canonical1967);
    expect(r.school).toBe("cn-mangpai");
    expect(r.primary).toBe("wood");                       // 식상 (壬→木)
    // 월령 卯=wood 와 primary=wood 同氣 → "同氣" hint
    expect(r.emergenceHint).toContain("同氣");
    // 맹파 룰: gisin = CONTROLS[일간] = water 가 극하는 fire (재성).
    // plan 주석 "일간을 극하는 오행" 은 잘못, 실제 룰은 일간이 극하는 오행.
    expect(r.gisin).toContain("fire");
  });
});
