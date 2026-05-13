# 사주 Phase 3 — 세운 + 일진 자동화 + 대운 타임라인 Design Spec

- **Date**: 2026-05-14
- **Scope**: 올해 세운(년) + 월운 12개 단일 텍스트 / 매일 자정 일진 자동 생성 / 대운 수평 타임라인 + 클릭 인터랙션
- **Non-goals (Phase 4 이후)**: 궁합, 신살 chip, 직업 적성 점수 차트, 일진 캘린더 월 그리드, 작명
- **Status**: 사용자 승인 완료 (2026-05-14 brainstorm 세션)
- **Prerequisite**: Phase 0~2 (PR #49/#50/#51) 머지 완료. main에 `@gons/saju` + `features/saju-reading` + `/fortune/[profileId]` 존재. 운영 DB 0007 마이그레이션 적용 완료.

## 1. 배경

Phase 2 완료로 한자 사주팔자·오행·십신·격국·용신·대운(정적 스트립) + 5섹션 LLM 해설이 `/fortune/[profileId]`에 표시된다. Phase 3는 사주의 **시간적 흐름** 도메인을 추가:

- **대운(大運)**: 10년 단위 — Phase 2의 strip을 클릭 가능한 수평 타임라인으로 보강
- **세운(歲運)**: 한 해 — 입춘 기준 연 간지가 일간에 미치는 영향
- **월운**: 한 해의 12개월 — 절기 기준 월 간지. 세운 해설 안에 12개 단락으로 묶어 단일 markdown text
- **일진**: 매일 — 자정 KST cron이 모든 활성 프로필 × 오늘 일진을 자동 생성. 홈 위젯의 `오늘의 운세`를 정적 fortune-data.ts에서 DB 동적 읽기로 완전 교체

## 2. 데이터 흐름

```
[ 결정적 계산 — packages/saju ]
  computeYearPillar(year)          → Pillar
  computeMonthPillars(year)        → MonthPillar[12]
  computeDayPillar(date)           → Pillar
  tenGodsForPillar(dayStem, p)     → { stemTenGod, branchTenGod }

[ DB — drizzle 0008 ]
  saju_yearly_readings   (chart_id, year) UNIQUE — lazy 생성, 영구 캐시
  saju_daily_fortunes    (chart_id, for_date) UNIQUE — 매일 자정 cron 일괄

[ Cron — apps/cron ]
  매일 00:01 KST → POST /api/cron/generate-daily-fortunes
                  → 모든 활성 프로필 × 오늘 일진 일괄 생성

[ UI — /fortune/[profileId] ]
  ensureChartAndReadings  (Phase 1)
  generateYearlyReading   (lazy, 페이지 진입 시)
  getTodayDailyFortune    (DB read, cron이 채워둠)
  → SajuMajorFortuneTimeline + SajuYearlyReading + SajuDailyFortune
```

## 3. 계산 레이어 확장 — `packages/saju`

```
packages/saju/src/
├── (기존 모듈 — Phase 0)
├── yearPillar.ts        # NEW
├── yearPillar.test.ts
├── monthPillars.ts      # NEW
├── monthPillars.test.ts
├── dayPillar.ts         # NEW
├── dayPillar.test.ts
├── tenGodsFor.ts        # NEW
├── tenGodsFor.test.ts
└── dailyFortune.ts      # NEW — DailyFortunePayload 타입 + Zod 스키마
```

**공개 API 추가** (index.ts barrel):

```ts
export function computeYearPillar(year: number): Pillar;
export function computeMonthPillars(year: number): MonthPillar[];
export function computeDayPillar(date: string /* YYYY-MM-DD */): Pillar;
export function tenGodsForPillar(dayStem: Stem, pillar: Pillar): {
  stemTenGod: TenGod;
  branchTenGod: TenGod;
};

export interface MonthPillar {
  monthIndex: number;       // 1..12
  pillar: Pillar;
  startSolarDate: string;   // YYYY-MM-DD (절기 시작일)
  endSolarDate: string;     // YYYY-MM-DD (다음 절기 직전)
}

export interface DailyFortunePayload {
  forDate: string;
  dayPillar: string;
  summary: string;
  overallScore: number;     // 1..5
  scores: Array<{ label: string; score: number; note: string }>;
  hourly: Array<{ range: string; vibe: string; isGolden?: boolean }>;
  recommendations: string[];
  cautions: string[];
  remedy: {
    colors: string[]; directions: string[]; foods: string[]; items: string[];
  };
  closing: string;
}
export const dailyFortunePayloadSchema: ZodType<DailyFortunePayload>;
```

**구현 근거**

- `lunar-javascript`의 `Solar.fromYmd(y, m, d).getLunar().getEightChar()`가 4주 모두 반환 → 한 해 중간 날짜로 호출하면 그 해의 yearGan/yearZhi를 얻을 수 있음 (입춘 자동 반영)
- 월주는 절기 시작일 기준이라 `EightChar.getMonthGan/Zhi`를 12개월 시작일별로 호출
- 일진은 단일 날짜의 dayGan/dayZhi

**골든 케이스** (라이브러리 직접 실행으로 검증된 값)

| ID | 입력 | 기대 |
|----|------|------|
| Y1 | computeYearPillar(2026) | 丙午 ✓ |
| Y2 | computeYearPillar(1967) | 丁未 (G1) ✓ |
| Y3 | computeYearPillar(2024-06-01) — 입춘 후 | 甲辰 ✓ |
| Y4 | computeYearPillar(2024-01-15) — 입춘 전 | 癸卯 (전년) ✓ — 입춘 경계 검증 |
| M1 | computeMonthPillars(2026) 12개 | 1월=己丑 / 2월=庚寅 / 3월=辛卯 / 4월=壬辰 / 5월=癸巳 / 6월=甲午 / 7월=乙未 / 8월=丙申 / 9월=丁酉 / 10월=戊戌 / 11월=己亥 / 12월=庚子 ✓ |
| D1 | computeDayPillar("2026-05-14") | 戊子 ✓ |
| D2 | computeDayPillar("2026-05-13") | 丁亥 ✓ (현행 fortune-data.ts의 戊申은 PlayMCP 분석 잘못 — G1 壬辰일주와 동일 패턴) |
| TG1 | tenGodsForPillar("壬", {stem:"丙",branch:"午"}) | 천간=偏財, 지지=正財 |

⚠️ **현행 fortune-data.ts 정정**: 2026-05-13 일진을 `戊申`으로 박았으나 라이브러리 결과는 `丁亥`. Phase 3 머지 시 fortune-data.ts를 완전 삭제하면 이 잘못된 스냅샷도 함께 사라짐. G1 일주 정정과 동일한 후속 학습.

월주가 5월=甲午 가정에서 5월=癸巳로 정정된 이유: lunar-javascript는 절기 기준 월주를 반환 (寅월=2/4 04:02~3/5 21:59, 卯월=3/5~4/5, ...). 12개월 인덱스의 0~11은 양력 1~12월에 매핑.

## 4. DB 스키마 — Drizzle 마이그레이션 0008

```sql
CREATE TABLE saju_yearly_readings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id    uuid NOT NULL REFERENCES saju_charts(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  year_stem   char(1) NOT NULL,
  year_branch char(1) NOT NULL,
  body        text NOT NULL,
  model       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, year)
);

CREATE TABLE saju_daily_fortunes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id    uuid NOT NULL REFERENCES saju_charts(id) ON DELETE CASCADE,
  for_date    date NOT NULL,
  day_stem    char(1) NOT NULL,
  day_branch  char(1) NOT NULL,
  payload     jsonb NOT NULL,
  model       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, for_date)
);
CREATE INDEX saju_daily_fortunes_date_idx ON saju_daily_fortunes (for_date DESC);
```

**캐시·무효화**

- `saju_yearly_readings`: `(chart_id, year)` UNIQUE. 모델 변경 시 readings 재생성 (Phase 1 패턴)
- `saju_daily_fortunes`: `(chart_id, for_date)` UNIQUE. 매일 새 row INSERT, 영구 보관
- 차트 hash 변경 시 CASCADE로 yearly/daily 모두 자동 삭제

## 5. 일진 자동 생성 — Cron + API

### 5.1 Cron 추가 (`apps/cron/scheduler.js`)

```js
// 매일 00:01 KST — 일진 자동 생성 (자정 정각의 다른 작업과 겹치지 않게 +1분)
cron.schedule(
  "1 0 * * *",
  () => void callCron("/api/cron/generate-daily-fortunes", "generate-daily-fortunes"),
  { timezone: TIMEZONE },
);
```

### 5.2 API 라우트 — `apps/dashboard/src/app/api/cron/generate-daily-fortunes/route.ts`

기존 `/api/cron/*` 패턴 그대로:
- Bearer 토큰 검증 → 401
- KST 오늘 날짜 계산
- 활성 프로필 + 차트 INNER JOIN (차트 없는 프로필은 skip — 사용자가 상세 페이지 진입 안 한 상태)
- 각 프로필 × 오늘 일진을 `Promise.allSettled` 병렬 생성
- 응답: `{ forDate, total, succeeded, failed, errors }`

### 5.3 `generateDailyFortune` — `features/saju-reading/api/generateDailyFortune.ts`

```
1. cache 조회 (chart_id, for_date) UNIQUE
2. cache && cache.model === env.SAJU_LLM_MODEL → return (skip, idempotent)
3. dayPillar = computeDayPillar(forDate)
4. tenGods = tenGodsForPillar(chart.day_stem, dayPillar)
5. await assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW)
6. LLM 호출 — JSON 스키마 강제 프롬프트 (DailyFortunePayload)
7. dailyFortunePayloadSchema.safeParse(JSON.parse(body))
   실패 시 1회 재시도 (system prompt에 "JSON only" 강조 추가). 그래도 실패 시 throw
8. logSajuSpend + UPSERT (onConflictDoUpdate)
```

### 5.4 JSON 스키마 강제 프롬프트 — `features/saju-reading/lib/dailyPrompt.ts`

```ts
export function buildDailyPrompt(input: {
  chart: SajuChart;
  dayPillar: Pillar;
  tenGods: { stemTenGod: TenGod; branchTenGod: TenGod };
  forDate: string;
}): { system: string; user: string };
```

system: 기존 SAJU_SYSTEM_PROMPT + "응답은 반드시 다음 JSON 스키마로만, 다른 텍스트 없이."
user: 명주 차트 결정적 정보 + 일진 간지 + 십신 + 출력 스키마

## 6. 세운 + 월운 — Lazy 생성

### 6.1 `generateYearlyReading` — `features/saju-reading/api/generateYearlyReading.ts`

```
1. cache 조회 (chart_id, year) UNIQUE — model 일치 시 skip
2. yearPillar = computeYearPillar(year)
3. monthPillars = computeMonthPillars(year)
4. yearTenGods + 12 × monthTenGods 계산
5. await assertSajuBudgetOk
6. LLM 호출 — markdown 단일 텍스트 응답
7. logSajuSpend + UPSERT
```

### 6.2 프롬프트 — `features/saju-reading/lib/yearlyPrompt.ts`

system: 기존 SAJU_SYSTEM_PROMPT 재사용
user 구조:
- 명주 정보 (pillars/strength/pattern/yongSin/giSin)
- 올해 세운 간지 + 십신
- 월별 12개 간지 + 절기 시작일 + 십신
- 출력 요구: markdown 형식 (헤더 없음, 굵은 라벨 + 단락만)
  - `**올해 전체 흐름**` (3~4문장)
  - `**1월** ... **12월**` (각 1~2문장, 시작일 + 간지 + 십신 + 풀이)
  - `**올해의 핵심 조언**` (2~3문장)
- 전체 ~1200~1500자

### 6.3 비용 시뮬레이션 (Opus 4.7)

- input ~2500 tokens × $15/M = ~$0.04
- output ~1500 tokens × $75/M = ~$0.11
- 합 ~$0.15 ≈ 200원/1회. 영구 캐시. 프로필 5명이면 ~1000원/년

## 7. 대운 시각화 보강 — 수평 타임라인 + 클릭

### 7.1 컴포넌트 교체

`widgets/saju-detail/ui/SajuMajorFortuneStrip.tsx`를 **삭제**하고 `SajuMajorFortuneTimeline.tsx` + `SajuMajorFortuneTimelineClient.tsx`로 대체. barrel 갱신.

### 7.2 레이아웃

```
나이 축: 8세  18  28  38  48  58◀ 68  78  88  98
천간 칸 (오행 색): 壬 辛 庚 己 戊 丁 丙 乙 甲 癸
지지 칸 (오행 색): 寅 丑 子 亥 戌 酉 申 未 午 巳
십신:    편관 정관 편관 정관 편관 [현재] 편재 정재 편재 정재

[선택된 대운: 58세 丁酉]
정관(正官) 대운 — ... (해당 단락만 노출)
```

- 천간/지지 2층 막대, 각 칸 배경을 오행 색(`var(--color-{wood|fire|...})`)으로 인라인 style
- 현재 진행 중 대운: 테두리 2px accent + "진행 중" 배지
- 클릭 인터랙션: `selectedIndex` state → 아래 단락 교체
- 키보드 접근성: `<button>` + `aria-pressed` + `focus-visible:outline`

### 7.3 `splitMajorFortuneBody` 파서

major_fortune LLM 해설을 `**N세 XY (YYYY~)**` 패턴으로 segment 10개 + 종합 1개로 분리:

```ts
const re = /\*\*(\d+)세\s+(\S\S).*?\*\*([\s\S]*?)(?=\n\*\*\d+세|\n\n\*\*올해|$)/g;
```

### 7.4 major_fortune 프롬프트 포맷 강제

`lib/prompts.ts`의 major_fortune 섹션 instruction을 명시적 형식으로 갱신:

```
대운 10개를 다음 형식으로 출력 (각 항목 독립 단락):
**8세 壬寅 (1974~)** — 편관 대운... (2~3문장)
**18세 辛丑 (1984~)** — ...
...
**98세 ... ** — ...

마지막에 **올해 흐름** 단락 1개 추가 (현재 대운과 세운의 관계).
전체 약 800자.
```

`SECTION_MAX_TOKENS.major_fortune`을 800 → 1500으로 조정.

### 7.5 Fallback

`splitMajorFortuneBody` 결과 segments < 8이면 전체 body를 통째 표시 + 인터랙션 비활성 (단락 박스 자체를 숨김). 데이터 손실 없이 graceful degradation.

## 8. 페이지 통합 — `/fortune/[profileId]/page.tsx`

기존 흐름에 2 LLM 호출 + 2 widget 추가:

```
ensureChartAndReadings (Phase 1)
  ↓
Promise.allSettled([
  generateYearlyReading(chart, currentYear),
])
  ↓
getTodayDailyFortune(chart.id, kstToday)   // DB read only — cron이 만든 row
  ↓
render:
  SajuDetailHeader
  사주팔자 (SajuPillarsBoard)
  오행 / 격국·용신 (2 col)
  십신 (SajuTenGodsTable)
  대운 흐름 (SajuMajorFortuneTimeline)         ← Phase 3 교체
  올해 세운 (SajuYearlyReading)                ← Phase 3 신규
  오늘 일진 (SajuDailyFortune) — dailyRow 있을 때만 ← Phase 3 신규
  해설 5섹션 (SajuReadingSections)
```

## 9. 홈 위젯 교체 — `widgets/fortune/`

| 변경 | 내용 |
|------|------|
| 삭제 | `widgets/fortune/ui/fortune-data.ts` (정적 스냅샷) |
| 수정 | `FortuneCard.tsx` — `getTodayDailyFortunesForUser(userId, today)` Map 반환 + props 전달 |
| 수정 | `FortuneCardClient.tsx` — 셀렉터 + 선택된 프로필의 `SajuDailyFortune` 컴포넌트로 위임 |
| placeholder | dailyRow 없으면 "오늘 일진 준비 중 (자정 cron 대기)" 표시 |

`FortuneData` 타입을 `packages/saju/src/dailyFortune.ts`로 이전해 DB jsonb · LLM 응답 · UI props 한 곳에서 타입 일관.

## 10. Entities 추가 — `entities/saju-chart`

```ts
// api/getTodayDailyFortune.ts
export async function getTodayDailyFortune(
  chartId: string, forDate: string,
): Promise<SajuDailyFortuneRow | null>;

// api/getTodayDailyFortunesForUser.ts
export async function getTodayDailyFortunesForUser(
  userId: string, forDate: string,
): Promise<Map<string, SajuDailyFortuneRow>>;

// model/types.ts
export type SajuYearlyReadingRow = InferSelectModel<typeof sajuYearlyReadings>;
export type SajuDailyFortuneRow = InferSelectModel<typeof sajuDailyFortunes>;
```

`getTodayDailyFortunesForUser`는 `fortuneProfiles` INNER JOIN으로 userId 필터 — ownership 가드.

## 11. 보안

- `/api/cron/generate-daily-fortunes` — Bearer 토큰 검증 (기존 패턴)
- 페이지 진입 ownership — Phase 1 `getFortuneProfile(id, userId)` 패턴 그대로
- entities read API 2개 — userId 필터 (fortuneProfiles INNER JOIN)
- LLM 프롬프트 PII — 차트 결정적 결과만, 이름/도시 안 들어감 (spec §8 일관)
- 비용 가드 — `assertSajuBudgetOk` 재사용, 변경 없음

## 12. 환경 변수

추가 없음. Phase 1의 `SAJU_LLM_MODEL` / `SAJU_LLM_DAILY_BUDGET_KRW` / `SAJU_LLM_TEMPERATURE` / `CRON_BEARER_TOKEN` 재사용.

## 13. 테스트 전략

| 계층 | 위치 | 내용 |
|------|------|------|
| Unit (계산) | `packages/saju/src/{yearPillar,monthPillars,dayPillar,tenGodsFor}.test.ts` | 골든 케이스 Y1·Y2·Y3·M1·D1·D2·TG1 |
| Unit (parser) | `widgets/saju-detail/ui/splitMajorFortuneBody.test.ts` | 정규식 splitting 정상 10단락 / fallback 케이스 |
| Unit (LLM mock) | `features/saju-reading/api/generateDailyFortune.test.ts` | cache hit / miss / model change / Zod 실패 + 재시도 |
| Unit (LLM mock) | `features/saju-reading/api/generateYearlyReading.test.ts` | cache hit / miss / model change |
| Integration | `tests/saju-cron-daily.integration.test.ts` | TEST_DATABASE_URL — cron API → daily_fortunes row 검증 (anthropic mock) |
| E2E | 수동 운영 검증 — cron 1회 트리거 → DB row 확인 + 홈 위젯 표시 |

## 14. 롤아웃

단일 PR (A안). Phase 0~2 PR 흐름 그대로:

1. brainstorm → spec → plan → subagent-driven execution
2. PR 생성 → CI 통과 → 머지 → main 빌드 + GHCR push
3. 운영 적용:
   ```
   I_KNOW_THIS_IS_PROD=1 pnpm db:migrate
   docker --context home-server compose pull app cron
   docker --context home-server compose up -d app cron
   ```
4. 다음 자정 KST에 cron 자동 발화. 즉시 검증 원하면:
   ```
   curl -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" \
     https://gons.krdn.kr/api/cron/generate-daily-fortunes
   ```

## 15. 결정 근거 요약

| 결정 | 이유 |
|------|------|
| 단일 PR (A안) | Phase 0~2가 단일 PR 패턴 성공. 응집 도메인 변경. 사용자 결정 |
| 세운·월운 단일 markdown | LLM 호출 1회로 비용·복잡도 최소화. 사용자 결정 (Q1) |
| 일진 매일 자정 일괄 | 활성 프로필 N=2~5 예상, 비용 통제 가능. 사용자 결정 (Q2) |
| 일진 영구 보관 | PII 부담 없고 후속 캘린더 기능 확장 가능. 사용자 결정 (Q3) |
| 대운 타임라인 + 클릭 | 사용자 결정 (Q4). client component 1개로 격리, 키보드 접근성 |
| 홈 위젯 완전 교체 | 사용자 결정 (Q5). fortune-data.ts 정적 스냅샷 제거 |
| 일진 UI 기존 5점수 구조 재활용 | 사용자 결정 (Q6). LLM 출력을 JSON 스키마로 강제 |
| 비용 가드 기존 일별만 | 사용자 결정 (Q7). 추가 구조 없음 |
| FortuneData 타입을 packages/saju로 | DB jsonb · LLM 응답 · UI props 한 곳에서 타입 일관 |
| major_fortune 정규식 + 프롬프트 강제 | 출력 포맷 박아 파싱 가능. fallback으로 graceful degradation |

## 16. 리스크

| # | 리스크 | 완화 |
|---|--------|------|
| R1 | LLM Daily JSON 응답이 스키마 위반 | Zod 1회 재시도 + 그래도 실패 시 그 프로필 skip (다음 날 재시도) |
| R2 | major_fortune 정규식이 LLM 출력과 불일치 | fallback — segments < 8이면 전체 body 통째 표시, 인터랙션 비활성 |
| R3 | cron 일진 생성 중 예산 초과 | BudgetExceededError로 그 이후 프로필 skip → 다음 날 재시도. 5명 × ~200원 일치 가능성 모니터링 |
| R4 | 절기 경계일 (입춘 직전) computeYearPillar | lunar-javascript가 입춘 시각 정확히 반영 (Phase 0 G3에서 검증). Y3 골든 케이스 추가 |
| R5 | major_fortune 프롬프트 변경이 Phase 2의 기존 LLM 캐시와 충돌 | 기존 캐시 body가 free-form일 가능성 → `splitMajorFortuneBody` < 8 → fallback 발동(전체 표시 + 인터랙션 비활성, 데이터 손실 없음). 새 포맷 강제 원하면 마이그레이션 0008에 `DELETE FROM saju_readings WHERE section='major_fortune'` 한 줄 추가 — Phase 3 plan에서 결정 |

## 17. 비-목표

- 궁합 (Phase 4 — 별도 spec)
- 신살(神煞) chip — 후속
- 직업 적성 점수 차트 — 후속
- 일진 캘린더 월 그리드 뷰 — 후속
- 작명 / 이름 풀이
- 일진의 시간대별 알림 (push notification) — 후속

## 18. CLAUDE.md Gotcha 대조

| Gotcha | 영향 |
|--------|------|
| #1 client barrel server-only 누출 | `entities/saju-chart` barrel은 이미 server-only. 신규 read API도 동일 패턴. UI는 deep import |
| #2 TEST_DATABASE_URL | integration 테스트 1개 추가. ECONNREFUSED skip 패턴 |
| #3 locale hydration mismatch | 일진 표시는 한자 + locale-free 포맷. 위험 없음 |
| #6 OAuth refreshAccountTokens | 무관 |
| (학습 메모리) Workspace 패키지 Dockerfile gotcha | packages/saju에 신규 모듈 추가만 — Dockerfile 변경 불필요 (이미 packages/saju 두 stage 박혀있음) |
| (학습 메모리) Opus 4.x temperature deprecated | callSajuLlm이 이미 모델별 조건부 전송 — 변경 불필요 |
