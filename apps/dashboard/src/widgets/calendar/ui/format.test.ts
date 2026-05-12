import { describe, expect, it } from "vitest";
import { formatDayLabel, formatHHMM } from "./format";

describe("formatHHMM", () => {
  it("converts UTC ISO to KST HH:MM", () => {
    // 2026-05-12T05:00:00Z → KST 14:00
    expect(formatHHMM("2026-05-12T05:00:00Z")).toBe("14:00");
  });

  it("wraps across UTC midnight into next-day KST morning", () => {
    // 2026-05-11T20:00:00Z → KST 2026-05-12 05:00
    expect(formatHHMM("2026-05-11T20:00:00Z")).toBe("05:00");
  });
});

describe("formatDayLabel", () => {
  // KST 2026-05-12 15:00 기준
  const now = new Date("2026-05-12T06:00:00Z");

  it("returns '오늘' for same KST date", () => {
    // KST 2026-05-12 23:00
    expect(formatDayLabel("2026-05-12T14:00:00Z", now)).toBe("오늘");
  });

  it("returns '내일' for next KST date", () => {
    // KST 2026-05-13 09:00
    expect(formatDayLabel("2026-05-13T00:00:00Z", now)).toBe("내일");
  });

  it("returns 'M/D (요일)' for further KST dates", () => {
    // KST 2026-05-15 (금요일) 18:00 — UTC 09:00
    expect(formatDayLabel("2026-05-15T09:00:00Z", now)).toBe("5/15 (금)");
  });

  it("handles week boundaries with correct weekday", () => {
    // KST 2026-05-17 (일요일) 10:00 — UTC 01:00
    expect(formatDayLabel("2026-05-17T01:00:00Z", now)).toBe("5/17 (일)");
  });
});
