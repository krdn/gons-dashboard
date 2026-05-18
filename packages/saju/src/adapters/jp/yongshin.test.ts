import { describe, expect, it } from "vitest";
import { buildYongshinJp } from "./yongshin";
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

describe("buildYongshinJp — canonical 1967", () => {
  it("재성·관성·인성 favorable, 식상·비겁 unfavorable", () => {
    const r = buildYongshinJp(canonical1967);
    expect(r.school).toBe("jp");
    expect(r.favorable).toContain("재성");
    expect(r.favorable).toContain("관성");
    expect(r.favorable).toContain("인성");
    expect(r.unfavorable).toContain("식상");
    expect(r.unfavorable).toContain("비겁");
  });
});
