// KST 경계 계산 회귀 (이슈 #323 §I).
//
// 관심사: 위젯의 집계 구간이 사주 예산 가드(budget.ts todayKstRange)와
// 정확히 같은 하루를 가리키는가. 갈리면 "위젯엔 여유, 실제론 예산 초과"가 된다.
import { describe, expect, it } from "vitest";
import { kstDayRange, kstMonthRange } from "@/shared/lib/kst-range";

/** budget.ts 의 todayKstRange 를 그대로 옮긴 것 — 동치성 대조용 기준. */
function budgetTodayKstRange(now: Date) {
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstMidnight = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()),
  );
  const start = new Date(kstMidnight.getTime() - 9 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

describe("kstDayRange", () => {
  it("budget.ts 의 todayKstRange 와 동치다", () => {
    // 경계 근처를 포함해 폭넓게 — UTC 날짜와 KST 날짜가 갈리는 시각이 핵심.
    const samples = [
      "2026-07-20T00:00:00Z", // KST 09:00 같은 날
      "2026-07-19T15:00:00Z", // KST 00:00 정각 (경계)
      "2026-07-19T14:59:59Z", // KST 23:59:59 전날
      "2026-01-01T16:00:00Z", // KST 다음 해 01-02
      "2026-12-31T15:00:00Z", // KST 2027-01-01
    ];
    for (const s of samples) {
      const now = new Date(s);
      expect(kstDayRange(now)).toEqual(budgetTodayKstRange(now));
    }
  });

  it("KST 자정 정각은 그 날의 시작이다 (직전 날에 속하지 않음)", () => {
    // 15:00Z = KST 00:00 — off-by-one 이면 하루 전체가 어긋난다.
    const midnightKst = new Date("2026-07-19T15:00:00Z");
    expect(kstDayRange(midnightKst).start.toISOString()).toBe(
      "2026-07-19T15:00:00.000Z",
    );
  });

  it("구간은 정확히 24시간이다", () => {
    const { start, end } = kstDayRange(new Date("2026-07-20T03:00:00Z"));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("kstMonthRange", () => {
  it("KST 월초 자정에서 다음 월초 자정까지", () => {
    const { start, end } = kstMonthRange(new Date("2026-07-20T03:00:00Z"));
    expect(start.toISOString()).toBe("2026-06-30T15:00:00.000Z"); // KST 07-01 00:00
    expect(end.toISOString()).toBe("2026-07-31T15:00:00.000Z"); // KST 08-01 00:00
  });

  it("12월은 다음 해 1월로 넘어간다", () => {
    // Date.UTC 의 월 오버플로 정규화에 의존하는 지점.
    const { end } = kstMonthRange(new Date("2026-12-15T03:00:00Z"));
    expect(end.toISOString()).toBe("2026-12-31T15:00:00.000Z"); // KST 2027-01-01
  });

  it("월 경계 직전/직후가 서로 다른 달로 갈린다", () => {
    const before = kstMonthRange(new Date("2026-06-30T14:59:59Z")); // KST 6/30 23:59
    const after = kstMonthRange(new Date("2026-06-30T15:00:00Z")); // KST 7/1 00:00
    expect(before.start.toISOString()).not.toBe(after.start.toISOString());
  });
});
