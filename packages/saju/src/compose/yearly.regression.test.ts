// Phase 6 Task 6.2 — 회귀 fixture 10건.
//
// empirical labeling: 각 fixture 의 expected verdict 는 실제 buildTriNationYearlyFromBirth
// 산출을 1회 관찰한 후 라벨링 (scripts/observe-yearly-verdicts.ts).
//
// 목적: packages/saju 의 어떤 변경이 발생해도 4학파 netVerdict 분기 + crossCheck.agreement
// 가 그대로인지 검증. 한 fixture 라도 verdict 가 바뀌면 회귀 감지.
//
// 커버리지 (4학파 × 3 verdict = 12 cell 중):
//   - KO: favorable / mixed / unfavorable 3 cell 커버 ✓
//   - CN자평: mixed / unfavorable 2 cell 커버 (favorable 미커버 — 향후 v0.3 에서 추가)
//   - CN맹파: mixed / unfavorable 2 cell 커버 (favorable 미커버 — 향후 v0.3 에서 추가)
//   - JP: mixed 1 cell 커버 (현재 10 fixture 모두 mixed — JP 어댑터 특성)
//   - crossCheck.agreement: medium / low 2 cell 커버 (high 는 wrapper.test 의 1967 fixture)
//
// 시간 의존성 회피: currentAge hardcoded (targetYear=2026 기준). resolveTrueSolar /
// verifyConsensus / computeSajuChart 모두 birthDateLocal/birthTimeLocal 만 사용.
import { describe, expect, it } from "vitest";
import { buildTriNationYearlyFromBirth } from "./yearly";
import type { BirthInputResolved } from "./lifetime";

type Verdict = "favorable" | "unfavorable" | "mixed";
type Agreement = "high" | "medium" | "low";

interface RegressionFixture {
  label: string;
  input: BirthInputResolved;
  currentAge: number;
  expected: {
    ko: Verdict;
    cnZiping: Verdict;
    cnMangpai: Verdict;
    jp: Verdict;
    agreement: Agreement;
  };
}

const TARGET_YEAR = 2026;

const fixtures: RegressionFixture[] = [
  {
    label: "1960-01-15 12:00 M (甲子月 근접)",
    input: { birthDateLocal: "1960-01-15", birthTimeLocal: "12:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "male" },
    currentAge: 66,
    expected: { ko: "mixed", cnZiping: "unfavorable", cnMangpai: "unfavorable", jp: "mixed", agreement: "medium" },
  },
  {
    label: "1975-07-04 18:00 F (한여름)",
    input: { birthDateLocal: "1975-07-04", birthTimeLocal: "18:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "female" },
    currentAge: 51,
    expected: { ko: "mixed", cnZiping: "mixed", cnMangpai: "mixed", jp: "mixed", agreement: "low" },
  },
  {
    label: "1985-11-20 03:00 M (한겨울 새벽)",
    input: { birthDateLocal: "1985-11-20", birthTimeLocal: "03:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "male" },
    currentAge: 41,
    expected: { ko: "favorable", cnZiping: "unfavorable", cnMangpai: "unfavorable", jp: "mixed", agreement: "medium" },
  },
  {
    label: "1990-05-08 09:00 F (입하)",
    input: { birthDateLocal: "1990-05-08", birthTimeLocal: "09:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "female" },
    currentAge: 36,
    expected: { ko: "mixed", cnZiping: "mixed", cnMangpai: "unfavorable", jp: "mixed", agreement: "low" },
  },
  {
    label: "1995-09-22 15:00 M (추분)",
    input: { birthDateLocal: "1995-09-22", birthTimeLocal: "15:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "male" },
    currentAge: 31,
    expected: { ko: "mixed", cnZiping: "mixed", cnMangpai: "mixed", jp: "mixed", agreement: "low" },
  },
  {
    label: "2000-02-29 06:00 F (윤년 2월말)",
    input: { birthDateLocal: "2000-02-29", birthTimeLocal: "06:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "female" },
    currentAge: 26,
    expected: { ko: "mixed", cnZiping: "mixed", cnMangpai: "mixed", jp: "mixed", agreement: "low" },
  },
  {
    label: "2005-12-25 22:00 M (동지)",
    input: { birthDateLocal: "2005-12-25", birthTimeLocal: "22:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "male" },
    currentAge: 21,
    expected: { ko: "favorable", cnZiping: "mixed", cnMangpai: "unfavorable", jp: "mixed", agreement: "low" },
  },
  {
    label: "2010-04-10 11:00 F (봄)",
    input: { birthDateLocal: "2010-04-10", birthTimeLocal: "11:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "female" },
    currentAge: 16,
    expected: { ko: "mixed", cnZiping: "mixed", cnMangpai: "mixed", jp: "mixed", agreement: "low" },
  },
  {
    label: "1953-08-15 14:00 M (광복일)",
    input: { birthDateLocal: "1953-08-15", birthTimeLocal: "14:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "male" },
    currentAge: 73,
    expected: { ko: "unfavorable", cnZiping: "unfavorable", cnMangpai: "mixed", jp: "mixed", agreement: "medium" },
  },
  {
    label: "1988-10-31 23:00 F (늦가을 밤)",
    input: { birthDateLocal: "1988-10-31", birthTimeLocal: "23:00", timezone: "Asia/Seoul", longitudeDeg: 127, calendar: "solar", gender: "female" },
    currentAge: 38,
    expected: { ko: "unfavorable", cnZiping: "unfavorable", cnMangpai: "mixed", jp: "mixed", agreement: "medium" },
  },
];

describe("buildTriNationYearlyFromBirth — 2026 회귀 fixture 10건", () => {
  for (const fx of fixtures) {
    it(`${fx.label} 의 verdict + agreement 가 라벨과 일치`, () => {
      const result = buildTriNationYearlyFromBirth({
        input: fx.input,
        targetYear: TARGET_YEAR,
        currentAge: fx.currentAge,
      });

      if (!result.ok) {
        throw new Error(`expected ok=true, got error: ${result.error.code}`);
      }

      expect(result.value.frames.ko.yongShinDelta.netVerdict).toBe(fx.expected.ko);
      expect(result.value.frames.cnZiping.yongShinDelta.netVerdict).toBe(fx.expected.cnZiping);
      expect(result.value.frames.cnMangpai.yongShinDelta.netVerdict).toBe(fx.expected.cnMangpai);
      expect(result.value.frames.jp.yongShinDelta.netVerdict).toBe(fx.expected.jp);
      expect(result.value.crossCheck.agreement).toBe(fx.expected.agreement);
    });
  }
});
