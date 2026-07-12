import { describe, expect, test } from "vitest";
import { formatDueLabel, formatKstNowLabel, parseDueAtIso } from "./dates";

describe("formatKstNowLabel", () => {
  test("UTC 시각을 KST 라벨로 — 요일 포함", () => {
    // 2026-07-12 (일) 22:30 KST = 13:30 UTC
    expect(formatKstNowLabel(new Date("2026-07-12T13:30:00Z"))).toBe("2026-07-12 (일) 22:30");
  });
  test("UTC/KST 날짜 경계 — UTC 저녁이 KST 다음 날 새벽", () => {
    // 2026-07-12T16:30Z = 2026-07-13 (월) 01:30 KST
    expect(formatKstNowLabel(new Date("2026-07-12T16:30:00Z"))).toBe("2026-07-13 (월) 01:30");
  });
});

describe("formatDueLabel", () => {
  test("시각 포함 / allDay는 날짜만", () => {
    const due = new Date(2026, 6, 15, 14, 0); // 로컬 7/15 14:00 (수)
    expect(formatDueLabel(due, false)).toBe("7/15(수) 14:00");
    expect(formatDueLabel(due, true)).toBe("7/15(수)");
  });
});

describe("parseDueAtIso", () => {
  test("유효 ISO(+09:00 오프셋)를 Date로", () => {
    const d = parseDueAtIso("2026-07-15T14:00:00+09:00");
    expect(d?.toISOString()).toBe("2026-07-15T05:00:00.000Z");
  });
  test("무효·빈 문자열·null은 null로 강등 (제안은 유지)", () => {
    expect(parseDueAtIso("다음주 화요일")).toBeNull();
    expect(parseDueAtIso("")).toBeNull();
    expect(parseDueAtIso(null)).toBeNull();
  });
});
