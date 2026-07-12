import { describe, expect, test } from "vitest";
import { computeDigestWindow, formatWeekLabel } from "./week";

// 2026-07-12 는 일요일. KST = UTC+9.
describe("computeDigestWindow", () => {
  test("일요일 19:00 이후 — 오늘이 weekEnd, 창은 [지난 일 19:00, 오늘 19:00)", () => {
    // 일요일 22:00 KST = 13:00 UTC
    const w = computeDigestWindow(new Date("2026-07-12T13:00:00Z"));
    expect(w.weekEnd).toBe("2026-07-12");
    expect(w.to.toISOString()).toBe("2026-07-12T10:00:00.000Z"); // 19:00 KST
    expect(w.from.toISOString()).toBe("2026-07-05T10:00:00.000Z");
  });

  test("일요일 19:00 정각도 due — 오늘이 weekEnd", () => {
    const w = computeDigestWindow(new Date("2026-07-12T10:00:00Z"));
    expect(w.weekEnd).toBe("2026-07-12");
  });

  test("일요일 19:00 전 — 지난주 일요일이 weekEnd", () => {
    // 일요일 08:00 KST = 토요일 23:00 UTC
    const w = computeDigestWindow(new Date("2026-07-11T23:00:00Z"));
    expect(w.weekEnd).toBe("2026-07-05");
  });

  test("주중(수요일) — 가장 최근 일요일이 weekEnd (월요일 catchup과 동일 창)", () => {
    const wed = computeDigestWindow(new Date("2026-07-08T03:00:00Z")); // 수 12:00 KST
    const mon = computeDigestWindow(new Date("2026-07-06T01:00:00Z")); // 월 10:00 KST
    expect(wed.weekEnd).toBe("2026-07-05");
    expect(mon.weekEnd).toBe("2026-07-05");
    expect(wed.from.toISOString()).toBe(mon.from.toISOString());
  });

  test("KST/UTC 날짜 경계 — 월요일 00:30 KST(UTC 일요일 저녁)", () => {
    // 월 2026-07-13 00:30 KST = 일 2026-07-12 15:30 UTC
    const w = computeDigestWindow(new Date("2026-07-12T15:30:00Z"));
    expect(w.weekEnd).toBe("2026-07-12");
  });

  test("연속 주 타일링 — 이번 주 to == 다음 주 from (빈틈·중복 없음)", () => {
    const thisWeek = computeDigestWindow(new Date("2026-07-12T13:00:00Z"));
    const nextWeek = computeDigestWindow(new Date("2026-07-19T13:00:00Z"));
    expect(nextWeek.from.toISOString()).toBe(thisWeek.to.toISOString());
  });
});

describe("formatWeekLabel", () => {
  test("weekEnd에서 'M/D – M/D' 라벨 생성", () => {
    expect(formatWeekLabel("2026-07-12")).toBe("7/6 – 7/12");
  });
  test("월 경계를 넘는 주", () => {
    expect(formatWeekLabel("2026-08-02")).toBe("7/27 – 8/2");
  });
});
