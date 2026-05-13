# Saju Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사주의 시간적 흐름(대운·세운·월운·일진)을 도입. 대운은 클릭 가능한 수평 타임라인으로 강화, 세운+월운은 lazy 단일 markdown, 일진은 매일 자정 KST cron이 모든 활성 프로필 × 오늘 일진을 자동 생성해 DB 영구 보관. 홈 위젯의 정적 fortune-data.ts를 DB 동적 읽기로 완전 교체.

**Architecture:** `packages/saju`에 yearPillar/monthPillars/dayPillar/tenGodsFor + DailyFortunePayload Zod 추가 (순수 함수, 라이브러리 wrap). Drizzle 0008에 saju_yearly_readings + saju_daily_fortunes 신설. `features/saju-reading`에 generateDailyFortune (JSON 스키마 강제) + generateYearlyReading (markdown 단일 텍스트). `/api/cron/generate-daily-fortunes`가 매일 00:01 KST 자동 발화. 페이지에 2 widget 추가 + 대운 strip 교체.

**Tech Stack:** TypeScript 5, lunar-javascript@1.7.7, Drizzle ORM, Next.js 16 RSC + client component (대운 클릭), Anthropic SDK (claude-opus-4-7), node-cron, Vitest 4, react-markdown 10.

**Spec reference:** `docs/superpowers/specs/2026-05-14-saju-phase3-design.md` §3~§14.

**Prerequisite:** Phase 0~2 (PR #49/#50/#51) + Dockerfile fix (#52) + Opus temperature fix (#53) 모두 main 머지. 운영 DB 0007 적용 완료. 단일 브랜치 `feat/saju-phase3`에서 작업.

---

## File Structure

```
packages/saju/src/
├── (기존 — Phase 0)
├── yearPillar.ts                # Task 1
├── yearPillar.test.ts
├── monthPillars.ts              # Task 2
├── monthPillars.test.ts
├── dayPillar.ts                 # Task 3
├── dayPillar.test.ts
├── tenGodsFor.ts                # Task 4
├── tenGodsFor.test.ts
├── dailyFortune.ts              # Task 5 — DailyFortunePayload 타입 + Zod
└── index.ts                     # Task 5 — barrel 갱신

apps/dashboard/
├── drizzle/0008_*.sql           # Task 6 — drizzle-kit generate
├── drizzle/meta/0008_snapshot.json
├── drizzle/meta/_journal.json
├── src/shared/lib/db/schema.ts  # Task 6 — sajuYearlyReadings + sajuDailyFortunes
├── src/entities/saju-chart/
│   ├── model/types.ts                                    # Task 6 — Row 타입 추가
│   ├── api/getTodayDailyFortune.ts                       # Task 7
│   ├── api/getTodayDailyFortunesForUser.ts               # Task 7
│   └── index.ts                                          # Task 7 — barrel
├── src/features/saju-reading/
│   ├── lib/dailyPrompt.ts                                # Task 8
│   ├── lib/yearlyPrompt.ts                               # Task 10
│   ├── lib/prompts.ts                                    # Task 11 (modify) — major_fortune 포맷 강제
│   ├── api/generateDailyFortune.ts + .test.ts            # Task 8
│   ├── api/generateYearlyReading.ts + .test.ts           # Task 10
│   └── index.ts                                          # Task 10 — barrel
├── src/app/api/cron/generate-daily-fortunes/route.ts     # Task 9
├── src/widgets/saju-detail/ui/
│   ├── splitMajorFortuneBody.ts + .test.ts               # Task 11
│   ├── SajuMajorFortuneTimeline.tsx                      # Task 11 (server wrapper)
│   ├── SajuMajorFortuneTimelineClient.tsx                # Task 11 ("use client")
│   ├── SajuMajorFortuneStrip.tsx                         # Task 11 — DELETE
│   ├── SajuYearlyReading.tsx                             # Task 12
│   ├── SajuDailyFortune.tsx                              # Task 12
│   └── index.ts                                          # Task 12 (barrel)
├── src/widgets/fortune/ui/
│   ├── fortune-data.ts                                   # Task 13 — DELETE
│   ├── FortuneCard.tsx                                   # Task 13 (modify)
│   └── FortuneCardClient.tsx                             # Task 13 (modify)
├── src/app/fortune/[profileId]/page.tsx                  # Task 14 (modify)
└── tests/saju-cron-daily.integration.test.ts             # Task 9

apps/cron/scheduler.js                                    # Task 9 (modify)
```

---

## Task 1: `yearPillar.ts` — 양력 년도 → 간지

**Files:**
- Create: `packages/saju/src/yearPillar.ts`
- Create: `packages/saju/src/yearPillar.test.ts`

라이브러리 `Solar.fromYmdHms(year, 6, 1, 12, 0, 0).getLunar().getEightChar()`로 6월 1일 정오 기준 EightChar 추출 → year pillar. 6월 1일은 입춘(2월 초)을 한참 지났으므로 안전.

**입력이 `year`(number) 하나일 때는 6월 1일 가정 OK. 다만 사용자가 절기 경계 검증 필요 시 별도 함수가 있어야 함 — 그래서 두 가지 시그니처를 모두 제공.**

- [ ] **Step 1: 테스트 먼저 작성**

`packages/saju/src/yearPillar.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { computeYearPillar, computeYearPillarFromDate } from "./yearPillar";

describe("computeYearPillar", () => {
  it("Y1: 2026 → 丙午", () => {
    expect(computeYearPillar(2026)).toEqual({ stem: "丙", branch: "午" });
  });

  it("Y2: 1967 → 丁未 (G1 사용자)", () => {
    expect(computeYearPillar(1967)).toEqual({ stem: "丁", branch: "未" });
  });

  it("Y3: 2024-06-01 (입춘 후) → 甲辰", () => {
    expect(computeYearPillarFromDate("2024-06-01")).toEqual({ stem: "甲", branch: "辰" });
  });

  it("Y4: 2024-01-15 (입춘 전) → 癸卯 (전년)", () => {
    expect(computeYearPillarFromDate("2024-01-15")).toEqual({ stem: "癸", branch: "卯" });
  });
});
```

- [ ] **Step 2: 실패 확인**

```
pnpm --filter @gons/saju test yearPillar
```
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`packages/saju/src/yearPillar.ts`:
```ts
import { Solar } from "lunar-javascript";
import type { Pillar, Stem, Branch } from "./types";

/** 양력 년도 → 그 해의 간지. 입춘 후 6월 1일 정오 기준. */
export function computeYearPillar(year: number): Pillar {
  return computeYearPillarFromDate(`${year}-06-01`);
}

/** 특정 양력 날짜 기준의 연주. 입춘 경계 정확히 반영. */
export function computeYearPillarFromDate(date: string): Pillar {
  const [y, m, d] = date.split("-").map(Number);
  const solar = Solar.fromYmdHms(y, m, d, 12, 0, 0);
  const ec = solar.getLunar().getEightChar();
  return {
    stem: ec.getYearGan() as Stem,
    branch: ec.getYearZhi() as Branch,
  };
}
```

- [ ] **Step 4: 테스트 통과 + 커밋**

```
pnpm --filter @gons/saju test yearPillar
pnpm --filter @gons/saju typecheck
```

Stage `packages/saju/src/yearPillar.ts` + `yearPillar.test.ts`:
```
feat(saju): yearPillar — 양력 년도 → 간지 (입춘 경계 반영)

computeYearPillar(year) + computeYearPillarFromDate(date) 두 시그니처.
4건 골든 케이스 통과 (Y1 2026=丙午, Y2 1967=丁未, Y3 2024-06-01=甲辰,
Y4 2024-01-15=癸卯 전년).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 2: `monthPillars.ts` — 양력 년도 → 12개월 간지

**Files:**
- Create: `packages/saju/src/monthPillars.ts`
- Create: `packages/saju/src/monthPillars.test.ts`

라이브러리는 절기 기준 월주를 반환. 각 양력 월의 15일 정오로 호출하면 그 절기에 해당하는 월주를 얻음 (절기는 보통 4~8일경이라 15일은 안전 buffer).

- [ ] **Step 1: 테스트**

`packages/saju/src/monthPillars.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { computeMonthPillars } from "./monthPillars";

describe("computeMonthPillars", () => {
  it("M1: 2026 12개월 — 라이브러리 검증된 정확한 매핑", () => {
    const r = computeMonthPillars(2026);
    expect(r).toHaveLength(12);
    expect(r[0].pillar).toEqual({ stem: "己", branch: "丑" });   // 1월
    expect(r[1].pillar).toEqual({ stem: "庚", branch: "寅" });   // 2월
    expect(r[2].pillar).toEqual({ stem: "辛", branch: "卯" });   // 3월
    expect(r[3].pillar).toEqual({ stem: "壬", branch: "辰" });   // 4월
    expect(r[4].pillar).toEqual({ stem: "癸", branch: "巳" });   // 5월
    expect(r[5].pillar).toEqual({ stem: "甲", branch: "午" });   // 6월
    expect(r[6].pillar).toEqual({ stem: "乙", branch: "未" });   // 7월
    expect(r[7].pillar).toEqual({ stem: "丙", branch: "申" });   // 8월
    expect(r[8].pillar).toEqual({ stem: "丁", branch: "酉" });   // 9월
    expect(r[9].pillar).toEqual({ stem: "戊", branch: "戌" });   // 10월
    expect(r[10].pillar).toEqual({ stem: "己", branch: "亥" });  // 11월
    expect(r[11].pillar).toEqual({ stem: "庚", branch: "子" });  // 12월
  });

  it("monthIndex는 1..12", () => {
    const r = computeMonthPillars(2026);
    expect(r.map((m) => m.monthIndex)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
  });

  it("startSolarDate는 YYYY-MM-15 형식 (절기 시작일 근사)", () => {
    const r = computeMonthPillars(2026);
    expect(r[4].startSolarDate).toBe("2026-05-15");
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`packages/saju/src/monthPillars.ts`:
```ts
import { Solar } from "lunar-javascript";
import type { Pillar, Stem, Branch } from "./types";

export interface MonthPillar {
  monthIndex: number;       // 1..12 (양력 월)
  pillar: Pillar;
  startSolarDate: string;   // YYYY-MM-15 (절기 안쪽 안전한 날, display용 근사)
  endSolarDate: string;
}

/**
 * 양력 년도 → 12개월 간지. 각 월의 15일 기준 EightChar.getMonthGan/Zhi 호출.
 * 절기 시작일은 정확히 계산하지 않고 YYYY-MM-15 근사값을 display 용으로 제공.
 */
export function computeMonthPillars(year: number): MonthPillar[] {
  const result: MonthPillar[] = [];
  for (let m = 1; m <= 12; m++) {
    const solar = Solar.fromYmdHms(year, m, 15, 12, 0, 0);
    const ec = solar.getLunar().getEightChar();
    const endMonth = m === 12 ? `${year + 1}-01-14` : `${year}-${String(m + 1).padStart(2, "0")}-14`;
    result.push({
      monthIndex: m,
      pillar: { stem: ec.getMonthGan() as Stem, branch: ec.getMonthZhi() as Branch },
      startSolarDate: `${year}-${String(m).padStart(2, "0")}-15`,
      endSolarDate: endMonth,
    });
  }
  return result;
}
```

⚠️ **간이 startSolarDate**: 진짜 절기 시작일 (입춘 2/4 04:02 등)을 박는 게 정확하지만, display 용도라 15일 근사로 충분. 정확한 절기 시각이 필요한 후속 spec에서 보강.

- [ ] **Step 3: 통과 + 커밋**

```
feat(saju): monthPillars — 양력 년도 → 12개월 간지 배열

15일 기준 EightChar.getMonthGan/Zhi 호출. 라이브러리가 절기 경계
자동 반영. 2026년 12개월 매핑 검증 (1월=己丑 ... 12월=庚子).
startSolarDate는 display용 YYYY-MM-15 근사.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 3: `dayPillar.ts` — 양력 날짜 → 일진

**Files:**
- Create: `packages/saju/src/dayPillar.ts`
- Create: `packages/saju/src/dayPillar.test.ts`

- [ ] **Step 1: 테스트**

`packages/saju/src/dayPillar.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { computeDayPillar } from "./dayPillar";

describe("computeDayPillar", () => {
  it("D1: 2026-05-14 → 戊子", () => {
    expect(computeDayPillar("2026-05-14")).toEqual({ stem: "戊", branch: "子" });
  });

  it("D2: 2026-05-13 → 丁亥 (현행 fortune-data.ts의 戊申은 잘못)", () => {
    expect(computeDayPillar("2026-05-13")).toEqual({ stem: "丁", branch: "亥" });
  });

  it("D3: 2026-05-15 → 己丑", () => {
    expect(computeDayPillar("2026-05-15")).toEqual({ stem: "己", branch: "丑" });
  });
});
```

- [ ] **Step 2: 구현**

`packages/saju/src/dayPillar.ts`:
```ts
import { Solar } from "lunar-javascript";
import type { Pillar, Stem, Branch } from "./types";

/** 양력 날짜 (YYYY-MM-DD) → 일진 간지. */
export function computeDayPillar(date: string): Pillar {
  const [y, m, d] = date.split("-").map(Number);
  const solar = Solar.fromYmdHms(y, m, d, 12, 0, 0);
  const ec = solar.getLunar().getEightChar();
  return {
    stem: ec.getDayGan() as Stem,
    branch: ec.getDayZhi() as Branch,
  };
}
```

- [ ] **Step 3: 통과 + 커밋**

```
feat(saju): dayPillar — 양력 날짜 → 일진 간지

정오 기준 EightChar.getDayGan/Zhi. 3건 골든 케이스 통과.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 4: `tenGodsFor.ts` — 일간 + 외부 간지 → 십신 쌍

**Files:**
- Create: `packages/saju/src/tenGodsFor.ts`
- Create: `packages/saju/src/tenGodsFor.test.ts`

Phase 0의 `tenGods.ts`가 export한 `tenGodOfStem` / `tenGodOfBranch` 재사용.

- [ ] **Step 1: 테스트**

```ts
import { describe, expect, it } from "vitest";
import { tenGodsForPillar } from "./tenGodsFor";

describe("tenGodsForPillar", () => {
  it("TG1: 壬日간 vs 丙午 → 偏財 / 正財", () => {
    // 壬(陽水) vs 丙(陽火): 水克火, 음양 같음 → 偏財
    // 壬 vs 午(본기 丁陰火): 水克火, 음양 다름 → 正財
    expect(tenGodsForPillar("壬", { stem: "丙", branch: "午" })).toEqual({
      stemTenGod: "偏財",
      branchTenGod: "正財",
    });
  });

  it("壬日간 vs 戊子 (D1 2026-05-14) → 偏官 / 劫財", () => {
    // 壬(陽水) vs 戊(陽土): 土克水, 음양 같음 → 偏官
    // 壬 vs 子(본기 癸陰水): 같은 오행, 음양 다름 → 劫財
    expect(tenGodsForPillar("壬", { stem: "戊", branch: "子" })).toEqual({
      stemTenGod: "偏官",
      branchTenGod: "劫財",
    });
  });
});
```

- [ ] **Step 2: 구현**

```ts
import type { Pillar, Stem, TenGod } from "./types";
import { tenGodOfStem, tenGodOfBranch } from "./tenGods";

export function tenGodsForPillar(dayStem: Stem, pillar: Pillar): {
  stemTenGod: TenGod;
  branchTenGod: TenGod;
} {
  return {
    stemTenGod: tenGodOfStem(dayStem, pillar.stem),
    branchTenGod: tenGodOfBranch(dayStem, pillar.branch),
  };
}
```

- [ ] **Step 3: 통과 + 커밋**

```
feat(saju): tenGodsFor — 일간 + 외부 간지 → 십신 쌍

세운·월운·일진 해석용. Phase 0의 tenGodOfStem/Branch 재사용.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 5: `dailyFortune.ts` Zod 스키마 + index.ts barrel

**Files:**
- Create: `packages/saju/src/dailyFortune.ts`
- Modify: `packages/saju/src/index.ts`

Phase 2에서 zod는 이미 `apps/dashboard`에 있지만 `packages/saju`엔 없음. Zod를 packages/saju에 추가 필요.

- [ ] **Step 1: zod 의존성 추가**

`packages/saju/package.json` dependencies에 추가:
```json
"zod": "^3.24.1"
```

`pnpm install` 후 lockfile 갱신.

- [ ] **Step 2: dailyFortune.ts 작성**

```ts
import { z } from "zod";

export const dailyFortuneScoreSchema = z.object({
  label: z.string(),
  score: z.number().int().min(1).max(5),
  note: z.string(),
});

export const dailyFortuneHourSlotSchema = z.object({
  range: z.string(),
  vibe: z.string(),
  isGolden: z.boolean().optional(),
});

export const dailyFortuneRemedySchema = z.object({
  colors: z.array(z.string()),
  directions: z.array(z.string()),
  foods: z.array(z.string()),
  items: z.array(z.string()),
});

export const dailyFortunePayloadSchema = z.object({
  forDate: z.string(),
  dayPillar: z.string(),
  summary: z.string(),
  overallScore: z.number().int().min(1).max(5),
  scores: z.array(dailyFortuneScoreSchema).length(5),
  hourly: z.array(dailyFortuneHourSlotSchema).min(7).max(12),
  recommendations: z.array(z.string()).min(1),
  cautions: z.array(z.string()).min(1),
  remedy: dailyFortuneRemedySchema,
  closing: z.string(),
});

export type DailyFortuneScore = z.infer<typeof dailyFortuneScoreSchema>;
export type DailyFortuneHourSlot = z.infer<typeof dailyFortuneHourSlotSchema>;
export type DailyFortuneRemedy = z.infer<typeof dailyFortuneRemedySchema>;
export type DailyFortunePayload = z.infer<typeof dailyFortunePayloadSchema>;
```

- [ ] **Step 3: index.ts barrel에 추가**

`packages/saju/src/index.ts`에 추가:
```ts
export { computeYearPillar, computeYearPillarFromDate } from "./yearPillar";
export { computeMonthPillars, type MonthPillar } from "./monthPillars";
export { computeDayPillar } from "./dayPillar";
export { tenGodsForPillar } from "./tenGodsFor";
export {
  dailyFortunePayloadSchema,
  type DailyFortunePayload,
  type DailyFortuneScore,
  type DailyFortuneHourSlot,
  type DailyFortuneRemedy,
} from "./dailyFortune";
```

- [ ] **Step 4: 검증 + 커밋**

```
pnpm --filter @gons/saju typecheck
pnpm --filter @gons/saju test
```
Expected: 모든 Phase 0 + Phase 3 task 1~4 테스트 통과.

```
feat(saju): dailyFortune Zod 스키마 + barrel 확장

DailyFortunePayload 타입 + dailyFortunePayloadSchema (5점수/시간대/처방/
recommendations/cautions/closing 검증). zod 의존성 추가.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 6: Drizzle 스키마 + 마이그레이션 0008

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts`
- Generate: `apps/dashboard/drizzle/0008_*.sql` + meta
- Modify: `apps/dashboard/src/entities/saju-chart/model/types.ts` — Row 타입 2개 추가

- [ ] **Step 1: schema.ts 끝에 2 테이블 추가**

```ts
/* =========================================================================
 * 사주 Phase 3 — spec §4
 * - saju_yearly_readings: 세운+월운 lazy 캐시
 * - saju_daily_fortunes: 매일 자정 cron 일괄 생성 + 영구 보관
 * ========================================================================= */
export const sajuYearlyReadings = pgTable(
  "saju_yearly_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => sajuCharts.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    yearStem: text("year_stem").notNull(),
    yearBranch: text("year_branch").notNull(),
    body: text("body").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saju_yearly_readings_chart_year_idx").on(t.chartId, t.year)],
);

export const sajuDailyFortunes = pgTable(
  "saju_daily_fortunes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => sajuCharts.id, { onDelete: "cascade" }),
    forDate: date("for_date").notNull(),
    dayStem: text("day_stem").notNull(),
    dayBranch: text("day_branch").notNull(),
    payload: jsonb("payload").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saju_daily_fortunes_chart_date_idx").on(t.chartId, t.forDate),
    index("saju_daily_fortunes_date_idx").on(t.forDate),
  ],
);
```

⚠️ `date` import 필요 — schema.ts 상단의 `from "drizzle-orm/pg-core"` 라인에 `date` 추가 (없으면).

- [ ] **Step 2: 마이그레이션 생성**

```
pnpm --filter @gons/dashboard drizzle-kit generate
```

생성된 `drizzle/0008_*.sql`에 다음 모두 포함되었는지 확인:
- `CREATE TABLE "saju_yearly_readings"` + FK ON CASCADE + `CREATE UNIQUE INDEX saju_yearly_readings_chart_year_idx`
- `CREATE TABLE "saju_daily_fortunes"` + FK ON CASCADE + `CREATE UNIQUE INDEX saju_daily_fortunes_chart_date_idx` + `CREATE INDEX saju_daily_fortunes_date_idx`

- [ ] **Step 3: types.ts에 Row 타입**

`apps/dashboard/src/entities/saju-chart/model/types.ts`에 추가:
```ts
import type { sajuYearlyReadings, sajuDailyFortunes } from "@/shared/lib/db/schema";

export type SajuYearlyReadingRow = InferSelectModel<typeof sajuYearlyReadings>;
export type SajuDailyFortuneRow = InferSelectModel<typeof sajuDailyFortunes>;
```

- [ ] **Step 4: typecheck + 커밋**

Stage: schema.ts, 0008_*.sql, 0008_snapshot.json, _journal.json, types.ts.

```
feat(saju): drizzle 0008 — saju_yearly_readings + saju_daily_fortunes

세운+월운 lazy 캐시 ((chart_id, year) UNIQUE) + 일진 매일 영구 보관
((chart_id, for_date) UNIQUE + for_date DESC 인덱스). spec §4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 7: `entities/saju-chart` read API 2개

**Files:**
- Create: `apps/dashboard/src/entities/saju-chart/api/getTodayDailyFortune.ts`
- Create: `apps/dashboard/src/entities/saju-chart/api/getTodayDailyFortunesForUser.ts`
- Modify: `apps/dashboard/src/entities/saju-chart/index.ts`

- [ ] **Step 1: getTodayDailyFortune.ts**

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { sajuDailyFortunes } from "@/shared/lib/db/schema";
import type { SajuDailyFortuneRow } from "../model/types";

export async function getTodayDailyFortune(
  chartId: string,
  forDate: string,
): Promise<SajuDailyFortuneRow | null> {
  const [row] = await db
    .select()
    .from(sajuDailyFortunes)
    .where(and(
      eq(sajuDailyFortunes.chartId, chartId),
      eq(sajuDailyFortunes.forDate, forDate),
    ))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 2: getTodayDailyFortunesForUser.ts**

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  fortuneProfiles,
  sajuCharts,
  sajuDailyFortunes,
} from "@/shared/lib/db/schema";
import type { SajuDailyFortuneRow } from "../model/types";

/**
 * user의 모든 활성 프로필 × today 일진 한 번에 페치.
 * 홈 위젯이 select 옆에서 선택된 프로필의 일진을 즉시 표시할 수 있도록.
 *
 * ownership 가드: fortuneProfiles.userId = ? INNER JOIN.
 */
export async function getTodayDailyFortunesForUser(
  userId: string,
  forDate: string,
): Promise<Map<string, SajuDailyFortuneRow>> {
  const rows = await db
    .select({
      profileId: fortuneProfiles.id,
      fortune: sajuDailyFortunes,
    })
    .from(sajuDailyFortunes)
    .innerJoin(sajuCharts, eq(sajuCharts.id, sajuDailyFortunes.chartId))
    .innerJoin(fortuneProfiles, eq(fortuneProfiles.id, sajuCharts.profileId))
    .where(and(
      eq(fortuneProfiles.userId, userId),
      eq(sajuDailyFortunes.forDate, forDate),
    ));

  const map = new Map<string, SajuDailyFortuneRow>();
  for (const r of rows) map.set(r.profileId, r.fortune);
  return map;
}
```

- [ ] **Step 3: index.ts barrel 갱신**

```ts
export { getSajuChartByProfile } from "./api/getSajuChartByProfile";
export type { SajuChartWithReadings } from "./api/getSajuChartByProfile";
export { getTodayDailyFortune } from "./api/getTodayDailyFortune";
export { getTodayDailyFortunesForUser } from "./api/getTodayDailyFortunesForUser";
export type {
  SajuChartRow,
  SajuReadingRow,
  SajuYearlyReadingRow,
  SajuDailyFortuneRow,
  ReadingSection,
} from "./model/types";
export { READING_SECTIONS, READING_SECTION_LABEL } from "./model/types";
```

- [ ] **Step 4: typecheck + 커밋**

```
feat(saju): entities/saju-chart — 일진 read API 2개

getTodayDailyFortune (chartId, forDate) + getTodayDailyFortunesForUser
(userId, forDate) → Map. ownership 가드 INNER JOIN.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 8: `generateDailyFortune` + dailyPrompt + TDD

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/lib/dailyPrompt.ts`
- Create: `apps/dashboard/src/features/saju-reading/api/generateDailyFortune.ts`
- Create: `apps/dashboard/src/features/saju-reading/api/generateDailyFortune.test.ts`

- [ ] **Step 1: dailyPrompt.ts**

```ts
import type {
  SajuChart, Pillar, TenGod,
} from "@gons/saju";

const SYSTEM_PROMPT = [
  "당신은 명리학자입니다.",
  "한자 + 한글 음을 병기하고, 추측·점성술 톤은 피하고,",
  "사주 구조에서 도출되는 결론만 제시합니다.",
  "응답은 반드시 다음 JSON 스키마로만, 다른 텍스트 없이.",
].join(" ");

const OUTPUT_SCHEMA = `{
  "summary": "string (한 문장, 한자 병기)",
  "overallScore": 1~5 정수,
  "scores": [
    { "label": "재물", "score": 1~5, "note": "한 문장" },
    { "label": "일", "score": 1~5, "note": "..." },
    { "label": "관계", "score": 1~5, "note": "..." },
    { "label": "건강", "score": 1~5, "note": "..." },
    { "label": "학습", "score": 1~5, "note": "..." }
  ],
  "hourly": [
    { "range": "05–07", "vibe": "string", "isGolden": false },
    { "range": "07–09", "vibe": "..." },
    { "range": "09–11", "vibe": "..." },
    { "range": "11–13", "vibe": "..." },
    { "range": "13–15", "vibe": "..." },
    { "range": "15–17", "vibe": "...", "isGolden": true 또는 false },
    { "range": "17–19", "vibe": "..." },
    { "range": "19–21", "vibe": "..." }
  ],
  "recommendations": ["string", "string", ...],
  "cautions": ["string", "string", ...],
  "remedy": {
    "colors": ["string", ...],
    "directions": ["string", ...],
    "foods": ["string", ...],
    "items": ["string", ...]
  },
  "closing": "string (한 문장)"
}`;

export interface BuildDailyPromptInput {
  chart: SajuChart;
  dayPillar: Pillar;
  tenGods: { stemTenGod: TenGod; branchTenGod: TenGod };
  forDate: string;
  retryWithEmphasis?: boolean;
}

export function buildDailyPrompt(input: BuildDailyPromptInput): {
  system: string;
  user: string;
} {
  const system = input.retryWithEmphasis
    ? `${SYSTEM_PROMPT}\n\n반드시 JSON만, 다른 텍스트(설명/마크다운 코드블록 포함) 절대 금지.`
    : SYSTEM_PROMPT;

  const user = [
    "[명주 정보]",
    JSON.stringify({
      pillars: input.chart.pillars,
      elements: input.chart.elements,
      strength: input.chart.strength,
      pattern: input.chart.pattern,
      yongSin: input.chart.yongSin,
      giSin: input.chart.giSin,
    }, null, 2),
    "",
    "[오늘 일진]",
    `${input.dayPillar.stem}${input.dayPillar.branch} (${input.forDate})`,
    `십신: 천간 ${input.tenGods.stemTenGod}, 지지 ${input.tenGods.branchTenGod}`,
    "",
    "[출력 스키마]",
    OUTPUT_SCHEMA,
    "",
    "위 스키마로만 JSON 응답.",
  ].join("\n");

  return { system, user };
}
```

- [ ] **Step 2: 테스트 먼저 — generateDailyFortune.test.ts**

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateDailyFortune } from "./generateDailyFortune";

vi.mock("../lib/llm-client", () => ({ callSajuLlm: vi.fn() }));
vi.mock("../lib/budget", () => ({
  assertSajuBudgetOk: vi.fn().mockResolvedValue(undefined),
  logSajuSpend: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class extends Error {},
}));
vi.mock("@/shared/lib/db/client", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));
vi.mock("@/shared/config/env", () => ({
  env: { SAJU_LLM_MODEL: "claude-opus-4-7", SAJU_LLM_DAILY_BUDGET_KRW: 1000, SAJU_LLM_TEMPERATURE: 0.3 },
}));

const FAKE_CHART_ROW = {
  id: "chart-1", profileId: "p-1", inputHash: "h1",
  yearStem: "丁", yearBranch: "未", monthStem: "癸", monthBranch: "卯",
  dayStem: "壬", dayBranch: "辰", hourStem: "癸", hourBranch: "卯",
  elements: { wood: 2, fire: 1, earth: 2, metal: 0, water: 3 },
  strength: "strong",
  tenGods: { yearStem: "正財", yearBranch: "正官", monthStem: "劫財",
             monthBranch: "傷官", dayBranch: "偏官",
             hourStem: "劫財", hourBranch: "傷官" },
  pattern: "傷官格",
  yongSin: ["fire", "earth"],
  giSin: ["earth", "water"],
  majorFortunes: [],
  createdAt: new Date(),
};

const VALID_PAYLOAD = {
  summary: "戊子 일진 — 편관·겁재가 동시...",
  dayPillar: "戊子",
  forDate: "2026-05-14",
  overallScore: 4,
  scores: [
    { label: "재물", score: 3, note: "..." },
    { label: "일", score: 4, note: "..." },
    { label: "관계", score: 3, note: "..." },
    { label: "건강", score: 4, note: "..." },
    { label: "학습", score: 4, note: "..." },
  ],
  hourly: Array.from({ length: 8 }, (_, i) => ({
    range: `${String(5 + i * 2).padStart(2, "0")}–${String(7 + i * 2).padStart(2, "0")}`,
    vibe: "...",
  })),
  recommendations: ["..."],
  cautions: ["..."],
  remedy: { colors: ["청색"], directions: ["북"], foods: ["..."], items: ["..."] },
  closing: "...",
};

describe("generateDailyFortune", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cache hit (model 일치) — LLM 호출 안 함", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([
        { model: "claude-opus-4-7", payload: VALID_PAYLOAD, dayStem: "戊", dayBranch: "子" },
      ]) }) }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");

    const result = await generateDailyFortune({
      chartRow: FAKE_CHART_ROW as any,
      forDate: "2026-05-14",
    });

    expect(result.cached).toBe(true);
    expect(callSajuLlm).not.toHaveBeenCalled();
  });

  it("cache miss — LLM 호출 + Zod 통과 + UPSERT", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: JSON.stringify(VALID_PAYLOAD),
      inputTokens: 1000, outputTokens: 500, krw: 100, model: "claude-opus-4-7",
    });
    const { logSajuSpend } = await import("../lib/budget");

    const result = await generateDailyFortune({
      chartRow: FAKE_CHART_ROW as any,
      forDate: "2026-05-14",
    });

    expect(result.cached).toBe(false);
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
    expect(logSajuSpend).toHaveBeenCalled();
  });

  it("Zod 검증 실패 → 1회 재시도", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any)
      .mockResolvedValueOnce({
        body: '{"summary": "incomplete"}',  // Zod fail
        inputTokens: 100, outputTokens: 50, krw: 10, model: "claude-opus-4-7",
      })
      .mockResolvedValueOnce({
        body: JSON.stringify(VALID_PAYLOAD),  // 재시도 성공
        inputTokens: 1000, outputTokens: 500, krw: 100, model: "claude-opus-4-7",
      });

    const result = await generateDailyFortune({
      chartRow: FAKE_CHART_ROW as any,
      forDate: "2026-05-14",
    });

    expect(result.cached).toBe(false);
    expect(callSajuLlm).toHaveBeenCalledTimes(2);
  });

  it("Zod 실패 + 재시도 실패 → throw", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: '{"oops": "still bad"}',
      inputTokens: 100, outputTokens: 50, krw: 10, model: "claude-opus-4-7",
    });

    await expect(
      generateDailyFortune({ chartRow: FAKE_CHART_ROW as any, forDate: "2026-05-14" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 실패 확인 → 구현**

`generateDailyFortune.ts`:
```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import {
  computeDayPillar, tenGodsForPillar,
  dailyFortunePayloadSchema, type DailyFortunePayload, type SajuChart,
  type Stem,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { sajuDailyFortunes } from "@/shared/lib/db/schema";
import type { SajuChartRow, SajuDailyFortuneRow } from "@/entities/saju-chart";
import { env } from "@/shared/config/env";
import { callSajuLlm } from "../lib/llm-client";
import { assertSajuBudgetOk, logSajuSpend } from "../lib/budget";
import { buildDailyPrompt } from "../lib/dailyPrompt";

export interface GenerateDailyFortuneInput {
  chartRow: SajuChartRow;
  forDate: string;
}

export interface GenerateDailyFortuneResult {
  row: SajuDailyFortuneRow | null;
  cached: boolean;
}

/** SajuChartRow 의 DB 컬럼들을 @gons/saju 의 SajuChart 형태로 변환. */
function chartRowToChart(row: SajuChartRow): SajuChart {
  return {
    pillars: {
      year: { stem: row.yearStem as Stem, branch: row.yearBranch as Stem },
      month: { stem: row.monthStem as Stem, branch: row.monthBranch as Stem },
      day: { stem: row.dayStem as Stem, branch: row.dayBranch as Stem },
      hour: row.hourStem && row.hourBranch
        ? { stem: row.hourStem as Stem, branch: row.hourBranch as Stem }
        : null,
    } as never,
    elements: row.elements as never,
    strength: row.strength as never,
    tenGods: row.tenGods as never,
    pattern: row.pattern,
    yongSin: row.yongSin as never,
    giSin: row.giSin as never,
    majorFortunes: row.majorFortunes as never,
    inputHash: row.inputHash,
  };
}

async function callAndValidate(
  input: GenerateDailyFortuneInput,
  retryWithEmphasis: boolean,
): Promise<{ payload: DailyFortunePayload; krw: number; model: string; inputTokens: number; outputTokens: number }> {
  const chart = chartRowToChart(input.chartRow);
  const dayPillar = computeDayPillar(input.forDate);
  const tenGods = tenGodsForPillar(input.chartRow.dayStem as Stem, dayPillar);
  const { system, user } = buildDailyPrompt({
    chart, dayPillar, tenGods, forDate: input.forDate, retryWithEmphasis,
  });
  const llm = await callSajuLlm({ system, user, maxTokens: 1500 });

  // markdown 코드블록 제거 (LLM이 ```json 으로 감쌀 때 대응)
  const trimmed = llm.body.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(trimmed);
  const validated = dailyFortunePayloadSchema.parse({
    ...parsed,
    dayPillar: `${dayPillar.stem}${dayPillar.branch}`,
    forDate: input.forDate,
  });
  return { payload: validated, krw: llm.krw, model: llm.model, inputTokens: llm.inputTokens, outputTokens: llm.outputTokens };
}

export async function generateDailyFortune(
  input: GenerateDailyFortuneInput,
): Promise<GenerateDailyFortuneResult> {
  // 1. cache 조회
  const [cached] = await db
    .select()
    .from(sajuDailyFortunes)
    .where(and(
      eq(sajuDailyFortunes.chartId, input.chartRow.id),
      eq(sajuDailyFortunes.forDate, input.forDate),
    ))
    .limit(1);

  if (cached && cached.model === env.SAJU_LLM_MODEL) {
    return { row: cached, cached: true };
  }

  // 2. 예산 가드
  await assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW);

  // 3. LLM 호출 + Zod 검증, 실패 시 1회 재시도
  let result;
  try {
    result = await callAndValidate(input, false);
  } catch (e1) {
    result = await callAndValidate(input, true);
  }

  // 4. spend log + UPSERT
  await logSajuSpend({
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    krw: result.krw,
  });

  const dayPillar = computeDayPillar(input.forDate);
  await db
    .insert(sajuDailyFortunes)
    .values({
      chartId: input.chartRow.id,
      forDate: input.forDate,
      dayStem: dayPillar.stem,
      dayBranch: dayPillar.branch,
      payload: result.payload,
      model: result.model,
    })
    .onConflictDoUpdate({
      target: [sajuDailyFortunes.chartId, sajuDailyFortunes.forDate],
      set: {
        dayStem: dayPillar.stem,
        dayBranch: dayPillar.branch,
        payload: result.payload,
        model: result.model,
        createdAt: new Date(),
      },
    });

  return { row: null, cached: false };  // 호출자가 row 필요하면 별도 조회. cron은 신경 안 씀.
}
```

⚠️ `chartRow.yearBranch as Stem` 같은 cast — `Branch`로 해야 함. Stem과 Branch 모두 단일 한자 string union이라 typecheck 통과는 되지만 의미상 정확히 박을 것.

- [ ] **Step 4: 통과 + 커밋**

```
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test generateDailyFortune
```
Expected: 4/4 PASS.

```
feat(saju): generateDailyFortune — JSON 스키마 강제 + 1회 재시도

cache hit (model 일치 시 skip) + assertSajuBudgetOk + LLM 호출 →
markdown 코드블록 제거 → JSON.parse → Zod 검증. 실패 시 system prompt
강조 추가로 1회 재시도, 또 실패 시 throw. UPSERT 패턴.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 9: 일진 cron API + scheduler 추가 + integration 테스트

**Files:**
- Create: `apps/dashboard/src/app/api/cron/generate-daily-fortunes/route.ts`
- Modify: `apps/cron/scheduler.js`
- Create: `apps/dashboard/tests/saju-cron-daily.integration.test.ts`

- [ ] **Step 1: route.ts**

```ts
import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles, sajuCharts } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { generateDailyFortune } from "@/features/saju-reading/api/generateDailyFortune";

function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_BEARER_TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = kstTodayDate();

  // 활성 프로필 + 차트 INNER JOIN (차트 없는 프로필은 skip — 사용자가 상세 진입 안 한 상태)
  const rows = await db
    .select({ chart: sajuCharts })
    .from(fortuneProfiles)
    .innerJoin(sajuCharts, eq(sajuCharts.profileId, fortuneProfiles.id))
    .where(eq(fortuneProfiles.isActive, true));

  const results = await Promise.allSettled(
    rows.map((r) => generateDailyFortune({ chartRow: r.chart, forDate: today })),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String(r.reason).slice(0, 200));

  return NextResponse.json({
    forDate: today,
    total: rows.length,
    succeeded,
    failed,
    errors,
  });
}
```

- [ ] **Step 2: apps/cron/scheduler.js 패치**

기존 두 cron.schedule 호출 다음에 추가:

```js
// 매일 00:01 KST — 일진 자동 생성 (자정 정각의 다른 작업과 분리)
cron.schedule(
  "1 0 * * *",
  () => {
    void callCron("/api/cron/generate-daily-fortunes", "generate-daily-fortunes");
  },
  { timezone: TIMEZONE },
);
```

그리고 마지막의 startup log 메시지도 갱신:
```js
console.log(
  "[cron] 스케줄 등록 완료. polling=0 * * * *, digest=0 8 * * * KST, daily-fortunes=1 0 * * * KST",
);
```

- [ ] **Step 3: integration 테스트 (TEST_DATABASE_URL 패턴)**

`apps/dashboard/tests/saju-cron-daily.integration.test.ts`:
```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  fortuneProfiles, sajuCharts, sajuDailyFortunes, users,
} from "@/shared/lib/db/schema";

vi.mock("@/features/saju-reading/lib/llm-client", () => ({
  callSajuLlm: vi.fn().mockResolvedValue({
    body: JSON.stringify({
      summary: "테스트 일진",
      overallScore: 3,
      scores: [
        { label: "재물", score: 3, note: "..." },
        { label: "일", score: 3, note: "..." },
        { label: "관계", score: 3, note: "..." },
        { label: "건강", score: 3, note: "..." },
        { label: "학습", score: 3, note: "..." },
      ],
      hourly: Array.from({ length: 8 }, (_, i) => ({
        range: `${String(5 + i * 2).padStart(2, "0")}–${String(7 + i * 2).padStart(2, "0")}`,
        vibe: "...",
      })),
      recommendations: ["..."],
      cautions: ["..."],
      remedy: { colors: ["청"], directions: ["북"], foods: ["..."], items: ["..."] },
      closing: "...",
    }),
    inputTokens: 1000, outputTokens: 500, krw: 100, model: "claude-opus-4-7",
  }),
}));
vi.mock("@/features/saju-reading/lib/budget", () => ({
  assertSajuBudgetOk: vi.fn().mockResolvedValue(undefined),
  logSajuSpend: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class extends Error {},
}));

const TEST_USER_ID = "00000000-0000-0000-0000-000000099991";
const TEST_PROFILE_ID = "00000000-0000-0000-0000-000000099992";
const TEST_CHART_ID = "00000000-0000-0000-0000-000000099993";

describe("/api/cron/generate-daily-fortunes integration", () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: TEST_USER_ID, email: "saju-cron-test@example.com",
    }).onConflictDoNothing();
    await db.insert(fortuneProfiles).values({
      id: TEST_PROFILE_ID, userId: TEST_USER_ID,
      name: "테스트", relation: "self",
      birthDate: "1967-03-29", birthTime: "05:30",
      calendar: "solar", gender: "male", birthCity: null,
      isActive: true,
    }).onConflictDoNothing();
    await db.insert(sajuCharts).values({
      id: TEST_CHART_ID, profileId: TEST_PROFILE_ID,
      inputHash: "test-hash",
      yearStem: "丁", yearBranch: "未", monthStem: "癸", monthBranch: "卯",
      dayStem: "壬", dayBranch: "辰", hourStem: "癸", hourBranch: "卯",
      elements: { wood: 2, fire: 1, earth: 2, metal: 0, water: 3 },
      strength: "strong",
      tenGods: {},
      pattern: "傷官格",
      yongSin: ["fire", "earth"],
      giSin: ["earth", "water"],
      majorFortunes: [],
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(sajuCharts).where(eq(sajuCharts.id, TEST_CHART_ID));
    await db.delete(fortuneProfiles).where(eq(fortuneProfiles.id, TEST_PROFILE_ID));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("bearer 토큰 없이 호출 → 401", async () => {
    const { POST } = await import("@/app/api/cron/generate-daily-fortunes/route");
    const res = await POST(new Request("http://localhost/api/cron/generate-daily-fortunes", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("올바른 토큰 → 활성 프로필 × 오늘 일진 생성 → saju_daily_fortunes row 추가", async () => {
    const { POST } = await import("@/app/api/cron/generate-daily-fortunes/route");
    const token = process.env.CRON_BEARER_TOKEN;
    const res = await POST(new Request("http://localhost/api/cron/generate-daily-fortunes", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBeGreaterThanOrEqual(1);

    // saju_daily_fortunes에 row 들어갔는지 검증
    const rows = await db
      .select()
      .from(sajuDailyFortunes)
      .where(eq(sajuDailyFortunes.chartId, TEST_CHART_ID));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].dayStem).toBeDefined();
    expect(rows[0].payload).toBeDefined();
  });
});
```

- [ ] **Step 4: typecheck + 커밋**

```
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test saju-cron-daily.integration
```

(DB 미연결 시 ECONNREFUSED 패턴은 그대로)

```
feat(saju): /api/cron/generate-daily-fortunes + scheduler 매일 자정 KST

활성 프로필 × 오늘 일진을 Promise.allSettled 로 병렬 생성. Bearer
토큰 검증. 응답에 {forDate, total, succeeded, failed, errors}.
apps/cron/scheduler.js 에 1 0 * * * KST 트리거 추가.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 10: `generateYearlyReading` + yearlyPrompt + TDD

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/lib/yearlyPrompt.ts`
- Create: `apps/dashboard/src/features/saju-reading/api/generateYearlyReading.ts`
- Create: `apps/dashboard/src/features/saju-reading/api/generateYearlyReading.test.ts`
- Modify: `apps/dashboard/src/features/saju-reading/index.ts`

- [ ] **Step 1: yearlyPrompt.ts**

```ts
import type {
  SajuChart, Pillar, TenGod, MonthPillar,
} from "@gons/saju";

const SYSTEM_PROMPT = [
  "당신은 명리학자입니다.",
  "한자 + 한글 음을 병기하고, 추측·점성술 톤은 피하고,",
  "사주 구조에서 도출되는 결론만 제시합니다.",
  "출력은 한국어 markdown text. 헤더(#)는 쓰지 말고 굵은 라벨(**) + 단락만.",
].join(" ");

export interface BuildYearlyPromptInput {
  chart: SajuChart;
  year: number;
  yearPillar: Pillar;
  yearTenGods: { stemTenGod: TenGod; branchTenGod: TenGod };
  monthPillars: MonthPillar[];
  monthTenGods: Array<{ stemTenGod: TenGod; branchTenGod: TenGod }>;
}

export function buildYearlyPrompt(input: BuildYearlyPromptInput): {
  system: string;
  user: string;
} {
  const monthLines = input.monthPillars.map((mp, i) => {
    const tg = input.monthTenGods[i];
    return `${mp.monthIndex}월 (${mp.startSolarDate}~): ${mp.pillar.stem}${mp.pillar.branch} — 천간 ${tg.stemTenGod}, 지지 ${tg.branchTenGod}`;
  });

  const user = [
    "[명주 정보]",
    JSON.stringify({
      pillars: input.chart.pillars,
      strength: input.chart.strength,
      pattern: input.chart.pattern,
      yongSin: input.chart.yongSin,
      giSin: input.chart.giSin,
    }, null, 2),
    "",
    `[${input.year}년 세운]`,
    `간지: ${input.yearPillar.stem}${input.yearPillar.branch}`,
    `십신: 천간 ${input.yearTenGods.stemTenGod}, 지지 ${input.yearTenGods.branchTenGod}`,
    "",
    "[월별 12개 간지]",
    ...monthLines,
    "",
    "[출력 요구]",
    "다음 구조의 한국어 markdown text 로 응답. 헤더(#) 금지, 굵은 라벨(**) + 단락만.",
    "",
    `**올해 전체 흐름** — ${input.year}년 ${input.yearPillar.stem}${input.yearPillar.branch}년이 일간에 미치는 영향. 용신·기신과의 관계, 신왕/신약 변동, 한 해의 큰 그림 (3~4문장).`,
    "",
    "**1월** — 절기 기준 시작일·간지·십신 짚고 한 줄 풀이 (1~2문장)",
    "**2월** ...",
    "**3월** ...",
    "**4월** ...",
    "**5월** ...",
    "**6월** ...",
    "**7월** ...",
    "**8월** ...",
    "**9월** ...",
    "**10월** ...",
    "**11월** ...",
    "**12월** ...",
    "",
    "**올해의 핵심 조언** — 용신·기신 + 세운 + 강세 월을 묶어 행동 지침 (2~3문장).",
    "",
    "전체 길이: 약 1200~1500자.",
  ].join("\n");

  return { system: SYSTEM_PROMPT, user };
}
```

- [ ] **Step 2: 테스트 — generateYearlyReading.test.ts**

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateYearlyReading } from "./generateYearlyReading";

vi.mock("../lib/llm-client", () => ({ callSajuLlm: vi.fn() }));
vi.mock("../lib/budget", () => ({
  assertSajuBudgetOk: vi.fn().mockResolvedValue(undefined),
  logSajuSpend: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class extends Error {},
}));
vi.mock("@/shared/lib/db/client", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));
vi.mock("@/shared/config/env", () => ({
  env: { SAJU_LLM_MODEL: "claude-opus-4-7", SAJU_LLM_DAILY_BUDGET_KRW: 1000, SAJU_LLM_TEMPERATURE: 0.3 },
}));

const FAKE_CHART = {
  pillars: { year: { stem: "丁", branch: "未" }, month: { stem: "癸", branch: "卯" },
            day: { stem: "壬", branch: "辰" }, hour: { stem: "癸", branch: "卯" } },
  elements: { wood: 2, fire: 1, earth: 2, metal: 0, water: 3 },
  strength: "strong" as const,
  tenGods: {} as never,
  pattern: "傷官格",
  yongSin: ["fire", "earth"],
  giSin: ["earth", "water"],
  majorFortunes: [],
  inputHash: "h1",
};

describe("generateYearlyReading", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cache hit (model 일치) → LLM 안 부름", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([
        { body: "cached body", model: "claude-opus-4-7" },
      ]) }) }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");

    const result = await generateYearlyReading({
      chart: FAKE_CHART as any, chartId: "c1", year: 2026,
    });

    expect(result).toEqual({ body: "cached body", cached: true });
    expect(callSajuLlm).not.toHaveBeenCalled();
  });

  it("cache miss → LLM 호출 + UPSERT", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: "**올해 전체 흐름** ...",
      inputTokens: 2500, outputTokens: 1500, krw: 200, model: "claude-opus-4-7",
    });

    const result = await generateYearlyReading({
      chart: FAKE_CHART as any, chartId: "c1", year: 2026,
    });

    expect(result).toEqual({ body: "**올해 전체 흐름** ...", cached: false });
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
  });

  it("model 변경 → 재생성", async () => {
    const { db } = await import("@/shared/lib/db/client");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([
        { body: "old", model: "claude-sonnet-4-6" },
      ]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body: "new body",
      inputTokens: 2000, outputTokens: 1500, krw: 200, model: "claude-opus-4-7",
    });

    const result = await generateYearlyReading({
      chart: FAKE_CHART as any, chartId: "c1", year: 2026,
    });

    expect(result.cached).toBe(false);
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: generateYearlyReading.ts**

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import {
  computeYearPillar, computeMonthPillars, tenGodsForPillar,
  type SajuChart, type Stem,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { sajuYearlyReadings } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { callSajuLlm } from "../lib/llm-client";
import { assertSajuBudgetOk, logSajuSpend } from "../lib/budget";
import { buildYearlyPrompt } from "../lib/yearlyPrompt";

export interface GenerateYearlyReadingInput {
  chart: SajuChart;
  chartId: string;
  year: number;
}

export interface GenerateYearlyReadingResult {
  body: string;
  cached: boolean;
}

export async function generateYearlyReading(
  input: GenerateYearlyReadingInput,
): Promise<GenerateYearlyReadingResult> {
  // 1. cache
  const [cached] = await db
    .select()
    .from(sajuYearlyReadings)
    .where(and(
      eq(sajuYearlyReadings.chartId, input.chartId),
      eq(sajuYearlyReadings.year, input.year),
    ))
    .limit(1);

  if (cached && cached.model === env.SAJU_LLM_MODEL) {
    return { body: cached.body, cached: true };
  }

  // 2. 결정적 계산
  const yearPillar = computeYearPillar(input.year);
  const monthPillars = computeMonthPillars(input.year);
  const dayStem = input.chart.pillars.day.stem as Stem;
  const yearTenGods = tenGodsForPillar(dayStem, yearPillar);
  const monthTenGods = monthPillars.map((mp) => tenGodsForPillar(dayStem, mp.pillar));

  // 3. 예산 가드
  await assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW);

  // 4. LLM
  const { system, user } = buildYearlyPrompt({
    chart: input.chart, year: input.year, yearPillar, yearTenGods,
    monthPillars, monthTenGods,
  });
  const llm = await callSajuLlm({ system, user, maxTokens: 2000 });

  // 5. spend + UPSERT
  await logSajuSpend({
    model: llm.model,
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    krw: llm.krw,
  });

  await db
    .insert(sajuYearlyReadings)
    .values({
      chartId: input.chartId,
      year: input.year,
      yearStem: yearPillar.stem,
      yearBranch: yearPillar.branch,
      body: llm.body,
      model: llm.model,
    })
    .onConflictDoUpdate({
      target: [sajuYearlyReadings.chartId, sajuYearlyReadings.year],
      set: {
        yearStem: yearPillar.stem,
        yearBranch: yearPillar.branch,
        body: llm.body,
        model: llm.model,
        createdAt: new Date(),
      },
    });

  return { body: llm.body, cached: false };
}
```

- [ ] **Step 4: index.ts barrel 갱신**

```ts
export { ensureChartAndReadings } from "./api/ensureChartAndReadings";
export type { EnsureChartAndReadingsResult } from "./api/ensureChartAndReadings";
export { revalidateSajuChart } from "./api/revalidateSajuChart";
export { generateYearlyReading } from "./api/generateYearlyReading";
export type {
  GenerateYearlyReadingResult,
} from "./api/generateYearlyReading";
```

(generateDailyFortune은 cron route + page에서 deep import — barrel 노출 안 해도 됨)

- [ ] **Step 5: 통과 + 커밋**

```
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test generateYearlyReading
```
Expected: 3/3 PASS.

```
feat(saju): generateYearlyReading — 세운+월운 lazy markdown

(chartId, year) UNIQUE cache. computeYearPillar + computeMonthPillars
+ tenGodsForPillar → buildYearlyPrompt (12개월 단락 포함) → LLM. 영구
캐시, 모델 변경 시 재생성.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 11: 대운 타임라인 + major_fortune 프롬프트 강제 + splitter

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/splitMajorFortuneBody.ts`
- Create: `apps/dashboard/src/widgets/saju-detail/ui/splitMajorFortuneBody.test.ts`
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuMajorFortuneTimeline.tsx`
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuMajorFortuneTimelineClient.tsx`
- Delete: `apps/dashboard/src/widgets/saju-detail/ui/SajuMajorFortuneStrip.tsx`
- Modify: `apps/dashboard/src/widgets/saju-detail/index.ts`
- Modify: `apps/dashboard/src/features/saju-reading/lib/prompts.ts` — major_fortune 포맷 강제

- [ ] **Step 1: splitMajorFortuneBody 테스트**

`splitMajorFortuneBody.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { splitMajorFortuneBody } from "./splitMajorFortuneBody";

describe("splitMajorFortuneBody", () => {
  it("정상 10단락 + 종합 — 10개 segment 반환", () => {
    const body = [
      "**8세 壬寅 (1974~)** — 편관 대운으로 청소년기 학업이...",
      "",
      "**18세 辛丑 (1984~)** — 정관 대운으로 직장...",
      "",
      "**28세 庚子 (1994~)** — ...",
      "",
      "**38세 己亥 (2004~)** — ...",
      "",
      "**48세 戊戌 (2014~)** — ...",
      "",
      "**58세 丁酉 (2024~)** — 현재 진행 중 ...",
      "",
      "**68세 丙申 (2034~)** — ...",
      "",
      "**78세 乙未 (2044~)** — ...",
      "",
      "**88세 甲午 (2054~)** — ...",
      "",
      "**98세 癸巳 (2064~)** — ...",
      "",
      "**올해 흐름** — 2026년 丙午...",
    ].join("\n");

    const segments = splitMajorFortuneBody(body);
    expect(segments).toHaveLength(10);
    expect(segments[0]).toMatchObject({ age: 8, ganZhi: "壬寅" });
    expect(segments[5]).toMatchObject({ age: 58, ganZhi: "丁酉" });
    expect(segments[9]).toMatchObject({ age: 98, ganZhi: "癸巳" });
    expect(segments[5].body).toContain("현재 진행 중");
  });

  it("패턴 매칭 안 됨 — 빈 배열 반환 (fallback 신호)", () => {
    const body = "자유 형식 대운 풀이입니다.";
    const segments = splitMajorFortuneBody(body);
    expect(segments).toHaveLength(0);
  });

  it("8개 미만 (불완전) → 빈 배열로 처리 가능 (caller fallback)", () => {
    const body = [
      "**8세 壬寅** — ...",
      "**18세 辛丑** — ...",
    ].join("\n\n");
    const segments = splitMajorFortuneBody(body);
    expect(segments.length).toBeLessThan(8);  // caller가 fallback 결정
  });
});
```

- [ ] **Step 2: splitMajorFortuneBody.ts 구현**

```ts
export interface MajorFortuneSegment {
  age: number;
  ganZhi: string;
  body: string;
}

const SEGMENT_RE = /\*\*(\d+)세\s+(\S\S)(?:[^*]*?)?\*\*([\s\S]*?)(?=\n\*\*\d+세|\n\*\*올해|\n\*\*현재|$)/g;

export function splitMajorFortuneBody(body: string): MajorFortuneSegment[] {
  const matches = [...body.matchAll(SEGMENT_RE)];
  return matches.map((m) => ({
    age: Number(m[1]),
    ganZhi: m[2],
    body: m[3].trim().replace(/^—\s*/, ""),
  }));
}
```

- [ ] **Step 3: 테스트 통과 확인**

```
pnpm --filter @gons/dashboard test splitMajorFortuneBody
```
Expected: 3/3 PASS.

- [ ] **Step 4: major_fortune 프롬프트 포맷 강제**

`apps/dashboard/src/features/saju-reading/lib/prompts.ts` — `SECTION_INSTRUCTIONS.major_fortune` 교체:

```ts
  major_fortune: {
    instruction: [
      "대운 10개를 다음 형식으로 정확히 출력 (각 항목 독립 단락):",
      "",
      "**N세 XY (YYYY~)** — N세 시작 대운 풀이 2~3문장",
      "",
      "예시:",
      "**8세 壬寅 (1974~)** — 편관 대운으로 청소년기 학업·진로 압박. 寅木이 일간을 생하지 못해...",
      "",
      "10개 단락 끝에 빈 줄 + 종합 단락 1개 추가:",
      "**올해 흐름** — 현재 대운과 세운의 관계 (2~3문장).",
      "",
      "전체 약 800자.",
    ].join("\n"),
    targetChars: 800,
  },
```

또한 `SECTION_MAX_TOKENS.major_fortune` 800 → 1500으로 조정 (`generateReading.ts` 안):

`features/saju-reading/api/generateReading.ts` 의 `SECTION_MAX_TOKENS` 객체에서:
```diff
- major_fortune: 800,
+ major_fortune: 1500,
```

- [ ] **Step 5: SajuMajorFortuneTimelineClient.tsx (use client)**

```tsx
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  STEM_KO, BRANCH_KO, TEN_GOD_KO,
  STEM_ELEMENT, BRANCH_ELEMENT,
  tenGodsForPillar,
  type MajorFortune, type Stem, type Branch,
} from "@gons/saju";
import { splitMajorFortuneBody } from "./splitMajorFortuneBody";

export interface SajuMajorFortuneTimelineClientProps {
  majorFortunes: MajorFortune[];
  currentAge: number;
  dayStem: Stem;
  majorFortuneBody: string | null;
}

function findCurrentIndex(fortunes: MajorFortune[], age: number): number {
  for (let i = 0; i < fortunes.length; i++) {
    const next = fortunes[i + 1];
    if (age >= fortunes[i].startAge && (!next || age < next.startAge)) return i;
  }
  return 0;
}

export function SajuMajorFortuneTimelineClient({
  majorFortunes, currentAge, dayStem, majorFortuneBody,
}: SajuMajorFortuneTimelineClientProps) {
  const currentIndex = findCurrentIndex(majorFortunes, currentAge);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex);

  const segments = useMemo(
    () => (majorFortuneBody ? splitMajorFortuneBody(majorFortuneBody) : []),
    [majorFortuneBody],
  );
  const hasSegments = segments.length >= 8;

  const tenGodsList = useMemo(
    () => majorFortunes.map((mf) => tenGodsForPillar(dayStem, { stem: mf.stem as Stem, branch: mf.branch as Branch })),
    [majorFortunes, dayStem],
  );

  return (
    <div>
      {/* 나이 축 + 천간·지지 2층 막대 */}
      <ol className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {majorFortunes.map((mf, i) => {
          const isCurrent = i === currentIndex;
          const isSelected = i === selectedIndex;
          const stemEl = STEM_ELEMENT[mf.stem as Stem];
          const branchEl = BRANCH_ELEMENT[mf.branch as Branch];
          const tg = tenGodsList[i];
          return (
            <li key={`${mf.startYear}-${mf.stem}${mf.branch}`}>
              <button
                type="button"
                onClick={() => hasSegments && setSelectedIndex(i)}
                aria-pressed={isSelected}
                disabled={!hasSegments}
                className={`w-full rounded text-center ${
                  isCurrent
                    ? "border-2 border-[var(--color-accent)]"
                    : isSelected
                    ? "border-2 border-[var(--color-text-muted)]"
                    : "border border-[var(--color-hairline)]"
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]`}
              >
                <div className="text-[10px] py-1 text-[var(--color-text-subtle)] tabular-nums">{mf.startAge}세~</div>
                <div
                  className="h-9 flex items-center justify-center"
                  style={{ backgroundColor: `var(--color-${stemEl})`, color: "var(--color-surface)" }}
                >
                  <span style={{ fontFamily: "var(--font-hanja)" }} className="text-lg" lang="ko-Hani">
                    {mf.stem}
                  </span>
                </div>
                <div
                  className="h-9 flex items-center justify-center"
                  style={{ backgroundColor: `var(--color-${branchEl})`, color: "var(--color-surface)" }}
                >
                  <span style={{ fontFamily: "var(--font-hanja)" }} className="text-lg" lang="ko-Hani">
                    {mf.branch}
                  </span>
                </div>
                <div className="text-[10px] py-1 text-[var(--color-text-muted)]">
                  {STEM_KO[mf.stem as Stem]}{BRANCH_KO[mf.branch as Branch]}
                </div>
                <div className="text-[10px] py-0.5 text-[var(--color-text-muted)]">
                  {TEN_GOD_KO[tg.branchTenGod]}
                </div>
                {isCurrent && (
                  <div className="text-[10px] pb-1 font-medium text-[var(--color-accent)]">진행 중</div>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {/* 선택된 대운 단락 */}
      {hasSegments && (
        <article className="mt-6 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4">
          <h3 className="mb-2 text-sm font-semibold">
            {segments[selectedIndex]?.age}세 <span style={{ fontFamily: "var(--font-hanja)" }} lang="ko-Hani">{segments[selectedIndex]?.ganZhi}</span>
            {selectedIndex === currentIndex && (
              <span className="ml-2 text-xs font-medium text-[var(--color-accent)]">현재 진행 중</span>
            )}
          </h3>
          <div className="text-sm leading-relaxed text-[var(--color-text)]">
            <ReactMarkdown>{segments[selectedIndex]?.body ?? "(해설 없음)"}</ReactMarkdown>
          </div>
        </article>
      )}
      {!hasSegments && majorFortuneBody && (
        <article className="mt-6 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4">
          <div className="text-sm leading-relaxed text-[var(--color-text)] [&_p+p]:mt-2">
            <ReactMarkdown>{majorFortuneBody}</ReactMarkdown>
          </div>
        </article>
      )}
    </div>
  );
}
```

- [ ] **Step 6: SajuMajorFortuneTimeline.tsx (server wrapper)**

```tsx
import type { MajorFortune, Stem } from "@gons/saju";
import { SajuMajorFortuneTimelineClient } from "./SajuMajorFortuneTimelineClient";

export interface SajuMajorFortuneTimelineProps {
  majorFortunes: MajorFortune[];
  currentAge: number;
  dayStem: Stem;
  majorFortuneBody: string | null;
}

export function SajuMajorFortuneTimeline(props: SajuMajorFortuneTimelineProps) {
  return <SajuMajorFortuneTimelineClient {...props} />;
}
```

- [ ] **Step 7: 기존 Strip 삭제 + barrel 갱신**

```
rm apps/dashboard/src/widgets/saju-detail/ui/SajuMajorFortuneStrip.tsx
```

`apps/dashboard/src/widgets/saju-detail/index.ts` — `SajuMajorFortuneStrip` → `SajuMajorFortuneTimeline` 교체:

```ts
export { SajuDetailHeader } from "./ui/SajuDetailHeader";
export { SajuPillarsBoard } from "./ui/SajuPillarsBoard";
export { SajuElementsChart } from "./ui/SajuElementsChart";
export { SajuTenGodsTable } from "./ui/SajuTenGodsTable";
export { SajuPatternCard } from "./ui/SajuPatternCard";
export { SajuMajorFortuneTimeline } from "./ui/SajuMajorFortuneTimeline";  // RENAMED
export { SajuReadingSections } from "./ui/SajuReadingSection";
```

(SajuYearlyReading / SajuDailyFortune은 Task 12에서 추가.)

- [ ] **Step 8: typecheck + lint + 커밋**

```
pnpm --filter @gons/dashboard typecheck
pnpm --filter @gons/dashboard lint
```

```
feat(saju): 대운 타임라인 + major_fortune 프롬프트 포맷 강제

SajuMajorFortuneStrip 삭제 → SajuMajorFortuneTimeline + Client 분리
(나이축 + 천간/지지 2층 오행 막대 + 십신 + 현재 진행 중 accent).
splitMajorFortuneBody 정규식 파싱, segments<8 시 전체 body 통째 표시
fallback (인터랙션 비활성). major_fortune 프롬프트 포맷 명시적
강제 + max_tokens 800→1500.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 12: `SajuYearlyReading` + `SajuDailyFortune` + barrel

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuYearlyReading.tsx`
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuDailyFortune.tsx`
- Modify: `apps/dashboard/src/widgets/saju-detail/index.ts`

- [ ] **Step 1: SajuYearlyReading.tsx**

```tsx
import ReactMarkdown from "react-markdown";

export interface SajuYearlyReadingProps {
  body: string | null;
  error: string | null;
  year: number;
}

export function SajuYearlyReading({ body, error }: SajuYearlyReadingProps) {
  if (error) {
    return (
      <p className="text-sm text-[var(--color-severity-high)]">
        세운 생성 실패 — {error}. 새로고침으로 재시도.
      </p>
    );
  }
  if (!body) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">세운 풀이를 준비 중입니다…</p>
    );
  }
  return (
    <div className="text-sm leading-relaxed text-[var(--color-text)] [&_p+p]:mt-3 [&_strong]:font-semibold [&_strong]:text-[var(--color-text-muted)]">
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: SajuDailyFortune.tsx**

```tsx
import type { DailyFortunePayload } from "@gons/saju";

const SCORE_DOTS = [1, 2, 3, 4, 5] as const;

function ScoreDots({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${score} / 5`} role="img">
      {SCORE_DOTS.map((i) => (
        <span
          key={i}
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            i <= score ? "bg-[var(--color-accent)]" : "bg-[var(--color-hairline-strong)]"
          }`}
        />
      ))}
    </span>
  );
}

export interface SajuDailyFortuneProps {
  payload: DailyFortunePayload;
  dayPillar: string;
}

export function SajuDailyFortune({ payload, dayPillar }: SajuDailyFortuneProps) {
  const goldenHour = payload.hourly.find((h) => h.isGolden);
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs tabular-nums text-[var(--color-text-subtle)]">
          {payload.forDate} · 일진{" "}
          <span style={{ fontFamily: "var(--font-hanja)" }} lang="ko-Hani">{dayPillar}</span>
        </span>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <ScoreDots score={payload.overallScore} />
        <span className="text-xs text-[var(--color-text-subtle)]">
          종합 {payload.overallScore} / 5
        </span>
      </div>

      <p className="mb-4 text-sm text-[var(--color-text-muted)]">{payload.summary}</p>

      <ul className="mb-4 divide-y divide-[var(--color-hairline)]">
        {payload.scores.map((s) => (
          <li key={s.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{s.label}</span>
                <ScoreDots score={s.score} />
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{s.note}</p>
            </div>
          </li>
        ))}
      </ul>

      {goldenHour && (
        <div
          className="mb-4 rounded-lg px-3 py-2"
          style={{ borderColor: "var(--color-accent)", borderWidth: "1px",
                   backgroundColor: "color-mix(in oklch, var(--color-accent) 5%, transparent)" }}
        >
          <p className="text-xs font-medium text-[var(--color-text-muted)]">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] align-middle" />
            황금시간 {goldenHour.range}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{goldenHour.vibe}</p>
        </div>
      )}

      <details className="mb-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          시간대별 흐름 펼치기
        </summary>
        <ul className="mt-2 flex flex-col gap-1.5 pl-1">
          {payload.hourly.map((h) => (
            <li key={h.range} className="flex items-baseline gap-2 text-xs tabular-nums text-[var(--color-text-subtle)]">
              <span className={`min-w-[3.5rem] ${h.isGolden ? "text-[var(--color-accent)]" : ""}`}>
                {h.range}
              </span>
              <span className={h.isGolden ? "text-[var(--color-text)]" : ""}>{h.vibe}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="mb-1 font-medium text-[var(--color-text-muted)]">추천</p>
          <ul className="flex flex-col gap-1 text-[var(--color-text-subtle)]">
            {payload.recommendations.map((r) => (
              <li key={r} className="flex gap-1"><span aria-hidden>·</span><span>{r}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-medium text-[var(--color-text-muted)]">주의</p>
          <ul className="flex flex-col gap-1 text-[var(--color-text-subtle)]">
            {payload.cautions.map((c) => (
              <li key={c} className="flex gap-1"><span aria-hidden>·</span><span>{c}</span></li>
            ))}
          </ul>
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          오늘의 처방
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-subtle)]">
          <dt className="text-[var(--color-text-muted)]">색</dt>
          <dd>{payload.remedy.colors.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">방향</dt>
          <dd>{payload.remedy.directions.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">음식</dt>
          <dd>{payload.remedy.foods.join(", ")}</dd>
          <dt className="text-[var(--color-text-muted)]">아이템</dt>
          <dd>{payload.remedy.items.join(", ")}</dd>
        </dl>
      </details>

      <blockquote className="mt-4 border-l-2 border-[var(--color-hairline-strong)] pl-3 text-xs italic text-[var(--color-text-subtle)]">
        {payload.closing}
      </blockquote>
    </>
  );
}
```

- [ ] **Step 3: barrel 갱신**

```ts
export { SajuDetailHeader } from "./ui/SajuDetailHeader";
export { SajuPillarsBoard } from "./ui/SajuPillarsBoard";
export { SajuElementsChart } from "./ui/SajuElementsChart";
export { SajuTenGodsTable } from "./ui/SajuTenGodsTable";
export { SajuPatternCard } from "./ui/SajuPatternCard";
export { SajuMajorFortuneTimeline } from "./ui/SajuMajorFortuneTimeline";
export { SajuReadingSections } from "./ui/SajuReadingSection";
export { SajuYearlyReading } from "./ui/SajuYearlyReading";
export { SajuDailyFortune } from "./ui/SajuDailyFortune";
```

- [ ] **Step 4: typecheck + 커밋**

```
feat(saju): SajuYearlyReading + SajuDailyFortune 위젯

SajuYearlyReading: markdown body 렌더 + error/loading placeholder.
SajuDailyFortune: 기존 FortuneCardClient의 5점수/시간대/처방 구조를
일진 payload 기반으로 재구성. barrel 에 추가 노출.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 13: 홈 위젯 교체 — fortune-data.ts 삭제 + DB 동적 읽기

**Files:**
- Delete: `apps/dashboard/src/widgets/fortune/ui/fortune-data.ts`
- Modify: `apps/dashboard/src/widgets/fortune/ui/FortuneCard.tsx`
- Modify: `apps/dashboard/src/widgets/fortune/ui/FortuneCardClient.tsx`

- [ ] **Step 1: fortune-data.ts 삭제**

```
rm apps/dashboard/src/widgets/fortune/ui/fortune-data.ts
```

- [ ] **Step 2: FortuneCard.tsx 교체**

```tsx
import "server-only";
import { listFortuneProfiles } from "@/entities/fortune-profile";
import { getTodayDailyFortunesForUser } from "@/entities/saju-chart";
import { auth } from "@/shared/lib/auth";
import { FortuneCardClient } from "./FortuneCardClient";

function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function FortuneCard() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profiles = await listFortuneProfiles(session.user.id);
  const today = kstTodayDate();
  const fortunes = await getTodayDailyFortunesForUser(session.user.id, today);
  // Map → 직렬화 가능한 plain object로 변환 (client component 전달)
  const fortunesByProfile: Record<string, {
    forDate: string;
    dayStem: string;
    dayBranch: string;
    payload: unknown;
  }> = {};
  for (const [pid, row] of fortunes) {
    fortunesByProfile[pid] = {
      forDate: row.forDate as unknown as string,
      dayStem: row.dayStem,
      dayBranch: row.dayBranch,
      payload: row.payload,
    };
  }
  return (
    <FortuneCardClient
      profiles={profiles}
      fortunesByProfile={fortunesByProfile}
      today={today}
    />
  );
}
```

- [ ] **Step 3: FortuneCardClient.tsx 교체**

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  RELATION_LABEL,
  type FortuneProfile,
} from "@/entities/fortune-profile/model/types";
import type { DailyFortunePayload } from "@gons/saju";
import { SajuDailyFortune } from "@/widgets/saju-detail/ui/SajuDailyFortune";

interface FortuneByProfile {
  forDate: string;
  dayStem: string;
  dayBranch: string;
  payload: unknown;
}

interface Props {
  profiles: FortuneProfile[];
  fortunesByProfile: Record<string, FortuneByProfile>;
  today: string;
}

function pickDefaultProfileId(profiles: FortuneProfile[]): string | null {
  if (profiles.length === 0) return null;
  const self = profiles.find((p) => p.relation === "self");
  return (self ?? profiles[0]).id;
}

export function FortuneCardClient({ profiles, fortunesByProfile, today }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickDefaultProfileId(profiles),
  );

  const selectedFortune = useMemo(
    () => (selectedId ? fortunesByProfile[selectedId] : undefined),
    [selectedId, fortunesByProfile],
  );

  if (profiles.length === 0) {
    return (
      <section
        aria-labelledby="fortune-heading"
        className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
      >
        <h2 id="fortune-heading" className="mb-3 text-base font-semibold text-[var(--color-text-muted)]">
          오늘의 운세
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          사주 프로필을 추가하면 운세를 볼 수 있어요.
        </p>
        <Link
          href="/fortune"
          className="mt-3 inline-block text-xs text-[var(--color-accent)] hover:underline"
        >
          프로필 추가하러 가기 →
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="fortune-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="fortune-heading" className="text-base font-semibold text-[var(--color-text-muted)]">
          오늘의 운세
        </h2>
        <div className="flex items-center gap-3 text-xs">
          {selectedId && (
            <Link
              href={`/fortune/${selectedId}`}
              className="text-[var(--color-accent)] hover:underline"
              aria-label="사주 상세보기"
            >
              상세
            </Link>
          )}
          <Link
            href="/fortune"
            className="text-[var(--color-text-subtle)] hover:underline"
            aria-label="사주 프로필 관리"
          >
            관리
          </Link>
        </div>
      </div>

      <label className="mb-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span className="shrink-0">대상</span>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 rounded border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({RELATION_LABEL[p.relation]})
            </option>
          ))}
        </select>
      </label>

      {!selectedFortune ? (
        <div className="rounded-lg border border-dashed border-[var(--color-hairline-strong)] px-4 py-5">
          <p className="text-sm text-[var(--color-text-muted)]">
            오늘({today}) 일진 풀이를 준비 중입니다.
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            자정 KST cron 이 활성 프로필 × 오늘 일진을 자동 생성합니다.
            상세보기 페이지를 한 번도 열지 않은 프로필은 차트가 없어 일진도 없습니다.
          </p>
        </div>
      ) : (
        <SajuDailyFortune
          payload={selectedFortune.payload as DailyFortunePayload}
          dayPillar={`${selectedFortune.dayStem}${selectedFortune.dayBranch}`}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: typecheck + lint + 커밋**

```
pnpm --filter @gons/dashboard typecheck
pnpm --filter @gons/dashboard lint
```

```
feat(saju): 홈 위젯 fortune-data.ts 정적 스냅샷 제거 + DB 동적 읽기

FortuneCard 가 getTodayDailyFortunesForUser 로 활성 프로필 × 오늘
일진을 한 번에 페치 → FortuneCardClient 가 select 옆에서 선택된
프로필의 SajuDailyFortune 위젯에 위임. cron 이 만든 row 가 없으면
"준비 중" placeholder. 잘못된 정적 戊申 스냅샷도 함께 제거.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 14: 페이지 통합 — 2 widget + 1 LLM lazy + daily DB read

**Files:**
- Modify: `apps/dashboard/src/app/fortune/[profileId]/page.tsx`

- [ ] **Step 1: page.tsx 교체**

전체 코드 (기존 page.tsx를 이 코드로 교체):

```tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getFortuneProfile } from "@/entities/fortune-profile";
import {
  ensureChartAndReadings,
  generateYearlyReading,
} from "@/features/saju-reading";
import { getTodayDailyFortune } from "@/entities/saju-chart";
import {
  SajuDetailHeader,
  SajuPillarsBoard,
  SajuElementsChart,
  SajuTenGodsTable,
  SajuPatternCard,
  SajuMajorFortuneTimeline,
  SajuYearlyReading,
  SajuDailyFortune,
  SajuReadingSections,
} from "@/widgets/saju-detail";
import type {
  Element, MajorFortune, Strength, TenGodAssignment,
  Stem, DailyFortunePayload, SajuChart,
} from "@gons/saju";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ profileId: string }> };

function ageFromBirthDate(birthDate: string): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const hadBirthday =
    now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default async function SajuDetailPage({ params }: Props) {
  const { profileId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await getFortuneProfile(profileId, session.user.id);
  if (!profile) notFound();

  const currentAge = ageFromBirthDate(profile.birthDate);
  const currentYear = new Date().getFullYear();

  // 1. 차트 + 5섹션 해설 (Phase 1)
  const result = await ensureChartAndReadings({
    profileId, userId: session.user.id, currentAge,
  });
  if (!result) notFound();
  const { chart, readings, errors } = result;

  // 2. 차트를 SajuChart 형태로 narrow (yearly에 넘기기)
  const sajuChart: SajuChart = {
    pillars: {
      year: { stem: chart.yearStem as Stem, branch: chart.yearBranch as never },
      month: { stem: chart.monthStem as Stem, branch: chart.monthBranch as never },
      day: { stem: chart.dayStem as Stem, branch: chart.dayBranch as never },
      hour: chart.hourStem && chart.hourBranch
        ? { stem: chart.hourStem as Stem, branch: chart.hourBranch as never }
        : null,
    },
    elements: chart.elements as never,
    strength: chart.strength as Strength,
    tenGods: chart.tenGods as TenGodAssignment,
    pattern: chart.pattern,
    yongSin: chart.yongSin as Element[],
    giSin: chart.giSin as Element[],
    majorFortunes: chart.majorFortunes as MajorFortune[],
    inputHash: chart.inputHash,
  };

  // 3. 올해 세운 (lazy, allSettled로 부분 실패 허용)
  const yearlyPromise = generateYearlyReading({
    chart: sajuChart, chartId: chart.id, year: currentYear,
  });
  const dailyPromise = getTodayDailyFortune(chart.id, kstTodayDate());
  const [yearlyResult, dailyRow] = await Promise.all([
    yearlyPromise.then(
      (r) => ({ ok: true as const, body: r.body }),
      (e) => ({ ok: false as const, error: String(e).slice(0, 200) }),
    ),
    dailyPromise.catch(() => null),
  ]);

  const tenGods = chart.tenGods as TenGodAssignment;
  const strength = chart.strength as Strength;
  const yongSin = chart.yongSin as Element[];
  const giSin = chart.giSin as Element[];
  const majorFortunes = chart.majorFortunes as MajorFortune[];

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-12">
      <SajuDetailHeader profile={profile} />

      <section
        aria-labelledby="pillars-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2 id="pillars-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
          사주팔자
        </h2>
        <SajuPillarsBoard chart={chart} tenGods={tenGods} />
      </section>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section
          aria-labelledby="elements-heading"
          className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
        >
          <h2 id="elements-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
            오행 분포
          </h2>
          <SajuElementsChart elements={chart.elements as never} />
        </section>
        <section
          aria-labelledby="pattern-heading"
          className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
        >
          <h2 id="pattern-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
            격국 · 용신
          </h2>
          <SajuPatternCard
            pattern={chart.pattern}
            strength={strength}
            yongSin={yongSin}
            giSin={giSin}
          />
        </section>
      </div>

      <section
        aria-labelledby="ten-gods-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2 id="ten-gods-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
          십신
        </h2>
        <SajuTenGodsTable tenGods={tenGods} />
      </section>

      <section
        aria-labelledby="major-fortune-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2 id="major-fortune-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
          대운 흐름
        </h2>
        <SajuMajorFortuneTimeline
          majorFortunes={majorFortunes}
          currentAge={currentAge}
          dayStem={chart.dayStem as Stem}
          majorFortuneBody={readings.major_fortune}
        />
      </section>

      <section
        aria-labelledby="yearly-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2 id="yearly-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
          {currentYear}년 세운 · 월운
        </h2>
        <SajuYearlyReading
          body={yearlyResult.ok ? yearlyResult.body : null}
          error={yearlyResult.ok ? null : yearlyResult.error}
          year={currentYear}
        />
      </section>

      {dailyRow && (
        <section
          aria-labelledby="daily-heading"
          className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
        >
          <h2 id="daily-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
            오늘 일진
          </h2>
          <SajuDailyFortune
            payload={dailyRow.payload as DailyFortunePayload}
            dayPillar={`${dailyRow.dayStem}${dailyRow.dayBranch}`}
          />
        </section>
      )}

      <section aria-labelledby="readings-heading" className="mb-8">
        <h2 id="readings-heading" className="mb-4 text-base font-semibold">
          해설
        </h2>
        <SajuReadingSections readings={readings} errors={errors} />
      </section>
    </main>
  );
}
```

- [ ] **Step 2: typecheck + lint**

```
pnpm --filter @gons/dashboard typecheck
pnpm --filter @gons/dashboard lint
```

⚠️ `as never` cast가 많은데, jsonb 컬럼이라 unavoidable. 더 깔끔히 하려면 `entities/saju-chart`에 `parseChartRow(row): SajuChart` 헬퍼를 만들어 narrowing — 이번 task에서는 지면 위해 page.tsx에 inline 처리.

- [ ] **Step 3: 커밋**

```
feat(saju): /fortune/[profileId] 페이지 — 세운/일진/대운 타임라인 통합

ensureChartAndReadings + generateYearlyReading (lazy, allSettled) +
getTodayDailyFortune (cron이 채운 row 읽기). 페이지에 2 widget 추가
+ Strip → Timeline 교체. jsonb 필드를 SajuChart 로 narrow 후 props 전달.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 15: 전체 게이트 + PR 생성

- [ ] **Step 1: 루트 검증**

```
pnpm typecheck
pnpm --workspace-concurrency=1 lint
pnpm --filter @gons/saju test
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test
```

Expected:
- typecheck clean
- lint clean
- saju test: Phase 0 21건 + Phase 3 신규 (yearPillar 4 + monthPillars 3 + dayPillar 3 + tenGodsFor 2) = 33개+ PASS
- dashboard test: Phase 1 mock 3개 + Phase 2 smoke 1개 + Phase 3 신규 (generateDailyFortune 4 + generateYearlyReading 3 + splitMajorFortuneBody 3) + integration ECONNREFUSED skip

- [ ] **Step 2: push + PR 생성**

```
git push -u origin feat/saju-phase3
```

PR title: `feat(saju): Phase 3 — 세운 + 일진 자동화 + 대운 타임라인`

PR body 본문에:
- Summary (시간 흐름 도메인 + 8개 신규 위젯·API)
- Spec/Plan reference
- Test plan 체크리스트
- ⚠️ 운영 배포 절차: 0008 마이그레이션 적용 필수 (`I_KNOW_THIS_IS_PROD=1 pnpm db:migrate`) + 이미지 pull/up
- ⚠️ 첫 배포 후 즉시 일진 검증 원하면 수동 트리거:
  `curl -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" https://gons.krdn.kr/api/cron/generate-daily-fortunes`
- Next phase: Phase 4 궁합

---

## Self-Review 체크리스트

- [x] **Spec 커버리지**:
  - §3 계산 레이어 → Tasks 1~5 ✓
  - §4 DB 스키마 → Task 6 ✓
  - §5 일진 cron → Tasks 8·9 ✓
  - §6 세운 → Task 10 ✓
  - §7 대운 시각화 → Task 11 ✓
  - §8 페이지 통합 → Task 14 ✓
  - §9 홈 위젯 교체 → Task 13 ✓
  - §10 entities read API → Task 7 ✓
  - §11 보안 (ownership·bearer·PII) → Tasks 7·9에 명시 ✓
  - §13 테스트 → 각 Task TDD 단계 ✓
  - §14 롤아웃 → Task 15 PR body ✓
- [x] **Placeholder 스캔**: TBD/TODO 없음. ⚠️로 시작하는 인라인 가이드만 (라이브러리 API 변동 가능성·jsonb cast 한계 안내)
- [x] **타입 일관성**:
  - `Stem`/`Branch`/`Element`/`TenGod` — `@gons/saju` types에서 한 곳 export
  - `SajuChart` — Phase 0의 타입 그대로
  - `DailyFortunePayload` — Task 5에서 정의, Task 8 generateDailyFortune·Task 12 SajuDailyFortune·Task 13 FortuneCardClient·Task 14 page에서 모두 동일 import
  - `MonthPillar` — Task 2에서 정의, Task 10 yearlyPrompt에서 import
- [x] **함수 시그니처 일관**:
  - `computeYearPillar(year)` + `computeYearPillarFromDate(date)` — 호출 위치 모두 한 시그니처 사용
  - `tenGodsForPillar(dayStem, pillar)` — return `{stemTenGod, branchTenGod}` 일관
  - `generateDailyFortune({chartRow, forDate})` — cron route + page 모두 동일
  - `generateYearlyReading({chart, chartId, year})` — page에서 호출 정확
- [x] **새 학습 메모리 적용**:
  - workspace-package-dockerfile-gotcha — Phase 3는 packages/saju에 신규 모듈만 추가, Dockerfile 변경 불필요 ✓
  - anthropic-opus-temperature-deprecated — callSajuLlm 재사용 (모델별 조건부 전송 이미 적용) ✓
  - saju-G1-day-pillar-correction — G1 사용 시 壬辰일주 기준 ✓

---

## 메모

- **Phase 1 캐시 처리 (spec §16 R5)**: major_fortune 프롬프트 포맷 변경이 기존 캐시와 충돌할 수 있음. `splitMajorFortuneBody` segments < 8 시 fallback (전체 body 표시 + 인터랙션 비활성)으로 graceful degradation — 별도 마이그레이션 SQL 추가 안 함. 사용자가 페이지 진입 시 옛 캐시는 그대로 fallback, 모델 변경이나 hash 무효화 시 새 포맷으로 자동 재생성.
- **Phase 4 후속**: 궁합 (saju_compatibility 테이블 + 프로필 2인 선택), 신살 chip, 직업 적성 점수 차트, 일진 캘린더 월 그리드. 별도 spec.
- **운영 배포 즉시 일진 만들어두고 싶으면**: 머지 후 운영에서 수동 cron 트리거 1회 호출 → 활성 프로필 × 오늘 일진 즉시 생성. 다음 자정 KST부터 자동.
