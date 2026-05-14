# 사주 캐시-리딩 모듈 deepening — Design Spec

- **Date**: 2026-05-14
- **Scope**: 사주 리딩 3종(섹션 리딩 / 세운 / 일진) 생성 함수에 공통된 cache→예산 가드→LLM→validate→spend→upsert 시퀀스를 단일 캐시-리딩 모듈로 묶는다.
- **Non-goals**: 다른 deepening 후보들(친구션 #2 cron 셰이프, #3 entities barrel server-only 누출, #4 listContainers 가시성)은 본 spec 범위 밖. Phase 5+에서 별도 spec.
- **Status**: design grilling 완료, hybrid 결정 (2026-05-14 `/improve-codebase-architecture` 세션).
- **Prerequisite**: Phase 3 (PR #54) 머지 완료. main에 3개 generate\* 함수와 3개 cache 테이블 존재.

## 1. 배경 — 친구션 #1 (deepening 후보 survey 결과)

`features/saju-reading/api/` 의 3개 함수가 *동일한 6단계 시퀀스*를 베껴 쓰고 있다 — `generateReading.ts` (섹션 리딩, plain markdown), `generateDailyFortune.ts` (일진, JSON+Zod), `generateYearlyReading.ts` (세운, plain markdown).

공통 시퀀스:

```
1. SELECT from cache table by composite key
2. cache hit 유효성 검사 — 현재는 cached.model === env.SAJU_LLM_MODEL 만 비교
3. assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW)
4. callSajuLlm({ system, user, maxTokens })
5. (caller-specific) validate raw body
6. logSajuSpend + INSERT ... ON CONFLICT DO UPDATE
```

세 함수가 공유하는 5단계 시퀀스를 매번 다시 쓰는 것 자체가 shallow 신호. 새 리딩 종류(예: 월별 세운, 합/충 분석)를 추가할 때마다 같은 6단계 + cache invalidation 비교 + spend log 누락 위험이 N caller로 흩어진다.

**Deletion test**: 깊은 모듈을 지우면 — cache lookup, model+promptVersion 비교, budget assert, callSajuLlm, logSajuSpend, onConflictDoUpdate 시퀀스가 세 함수에 재분산. promptVersion 비교 한 곳에서 잊으면 stale cache 반환. **복잡성이 N caller로 다시 퍼짐 → 통과.**

## 2. 결정사항 (grilling 결과)

| ID | 결정 |
|---|---|
| **Q1** | cache invalidation key = `(model, promptVersion)` 둘 다. promptVersion 바뀌면 자동 재생성. |
| **Q2** | (c) — 결정적 계산(`computeDayPillar`, `computeYearPillar`, `computeMonthPillars`, `tenGodsForPillar`)은 캐시-리딩 모듈의 책임 *밖*. caller가 미리 호출해 prompt builder 에 넘긴다. |
| **Q3** | (a) — validator 슬롯. daily 는 JSON+Zod, 나머지는 identity. |
| **Q4** | (해당 없음 — C(2) 로 흡수) |
| **Q5** | (a) — caller 가 `(table, conflictTarget, toRow)` 제공. 깊은 모듈은 table-agnostic. |
| **Q6** | `{ data, cached }` — cache hit 시 `data` 는 row.body 또는 row.payload 에서 추출. |
| **Q7** | (c) — 일단 `features/saju-reading/lib/` 에 둠. 두 번째 non-saju caller 가 생기면 그때 `shared/lib/llm/` 로 끌어올림. *"One adapter = hypothetical seam. Two adapters = real one."* |
| **A** | buildPrompt 함수가 `version` 문자열을 같이 반환 (현재 `buildReadingPrompt`/`buildDailyPrompt`/`buildYearlyPrompt` 시그니처 확장 필요). |
| **B** | (i) — 세 테이블에 `prompt_version text NOT NULL` 컬럼 추가, UNIQUE 는 기존 그대로. 기존 행은 `'legacy-v0'` sentinel backfill — 첫 조회 시 mismatch 로 자동 재생성. |
| **C** | (2) — 깊은 모듈은 retry 모름. validate throw 그대로 위로. daily caller 가 try/catch 로 두 번 호출. retryWithEmphasis 같은 prompt 강화는 caller 의 prompt builder 가 처리. |
| **D** | validator 시그니처 = `(rawBody: string) => T`. |

## 3. 인터페이스 셰이프 (hybrid — Design 3 기반 + Design 1 의 정직한 trade-off 문서화 흡수)

세 후보 design 중 **공통 case 최적화** (Design 3) 를 채택. 이유 요약:

- 현재 N=3, 미래 N 대부분은 markdown body (yearly→monthly, compatibility 등) — 공통 case helper 가 즉시 leverage 생산.
- LLM port 는 보류 — 두 번째 adapter 가 *test only* 이고 `vi.mock("@/shared/lib/llm/anthropic")` 으로 충분. 진짜 두 번째 production caller 가 생길 때 정식 port 로 승격. ([DEEPENING.md] "One adapter = hypothetical seam.")
- 옵션 백 (forceRegenerate / softCacheOnLlmError / skipWrite / mapError / Telemetry) — caller 0명이므로 YAGNI 적용. 필요해질 때 확장.

### 3.1 모듈 위치

`apps/dashboard/src/features/saju-reading/lib/cachedReading.ts` (신규 파일)

### 3.2 Entry points (2개)

```ts
// 일반형 — daily 처럼 structured payload 가 필요할 때.
export async function cachedReading<TTable extends PgTable, TData>(
  input: CachedReadingInput<TTable, TData>,
): Promise<{ data: TData; cached: boolean }>;

// 공통 case sugar — markdown body, validator/promptVersion 기본값, toRow 합성.
export async function cachedMarkdownReading<TTable extends PgTable>(
  input: CachedMarkdownInput<TTable>,
): Promise<{ data: string; cached: boolean }>;
```

### 3.3 일반형 입력 셰이프

```ts
export interface CachedReadingInput<TTable extends PgTable, TData> {
  /** 캐시 테이블. `model`, `promptVersion` 컬럼 필수. */
  table: TTable;
  /** 캐시 키 — composite condition. */
  where: SQL;
  /** ON CONFLICT target. */
  conflictTarget: PgColumn[];
  /** 프롬프트 — 결정적 계산은 caller 가 미리 끝내서 넘긴다. */
  prompt: { system: string; user: string; maxTokens: number };
  /** 프롬프트 버전 — model 과 함께 cache 무효화 키. */
  promptVersion: string;
  /** raw body → 도메인 데이터. 기본 identity. 일진은 JSON+Zod. */
  validator?: (rawBody: string) => TData;
  /** UPSERT row 매핑. (data, meta) → INSERT/UPDATE set 컬럼. */
  toRow: (data: TData, meta: { model: string; promptVersion: string }) =>
    Record<string, unknown>;
  /** cache hit 시 row → data 추출. 기본은 row.body (string). daily 는 row.payload. */
  fromRow?: (row: TTable["$inferSelect"]) => TData;
  /** 단위 테스트용 escape hatch. 미지정 시 callSajuLlm 직접 호출. */
  callLlm?: typeof callSajuLlm;
}
```

### 3.4 Markdown sugar 입력 셰이프

```ts
export interface CachedMarkdownInput<TTable extends PgTable> {
  table: TTable;
  where: SQL;
  conflictTarget: PgColumn[];
  prompt: { system: string; user: string; maxTokens: number };
  promptVersion: string;
  /** body/model/promptVersion 외 컬럼 — caller-specific (chartId, section, yearStem 등). */
  extraColumns: Record<string, unknown>;
  callLlm?: typeof callSajuLlm;
}
```

내부적으로 `cachedReading<TTable, string>` 호출:
- `validator = (s) => s` (identity)
- `fromRow = (r) => r.body`
- `toRow = (data, meta) => ({ ...input.extraColumns, body: data, model: meta.model, promptVersion: meta.promptVersion })`
- UPSERT `set` 에 `createdAt: new Date()` 강제

### 3.5 Invariants (모듈 doc comment 명시)

1. **순서 고정**: cache.read → (miss/drift) → assertSajuBudgetOk → callLlm → validate → logSajuSpend → upsert.
2. **Cache hit 정의**: row 존재 + `row.model === env.SAJU_LLM_MODEL` + `row.promptVersion === input.promptVersion`. 둘 중 하나라도 mismatch 면 miss.
3. **재시도 없음**: validate throw → caller 에게 그대로 propagate. BudgetExceededError 동일.
4. **Validate 실패 시 spend 미기록**: 의도적 — daily caller 가 try/catch 로 재시도하면 두 번째 호출의 validate 가 성공한 경우에만 두 번 모두 spend 기록. 정직한 trade-off — Anthropic 에는 두 번 다 결제되지만 `llm_spend_log` 는 "validated outputs only".
5. **Server-only**: `"server-only"` import 강제.

### 3.6 무엇이 seam 뒤에 묻히나

caller 가 모르는 것:
- `db` import (`@/shared/lib/db/client`)
- `callSajuLlm` 직접 호출 경로 (옵션 `callLlm?` 미지정 시)
- `assertSajuBudgetOk` / `logSajuSpend` (예산 가드 정책)
- `env.SAJU_LLM_MODEL` 읽기 (model fingerprint 비교)
- 6단계 순서
- cache hit short-circuit 로직
- model vs promptVersion drift 분기 (둘 다 miss 로 통일 처리)
- `createdAt: new Date()` UPSERT set 강제

caller 가 책임지는 것 (외부 seam):
- 결정적 계산 호출 (`computeDayPillar` 등)
- 프롬프트 빌드 + `promptVersion` 상수
- `where` / `conflictTarget` / `toRow` (또는 `extraColumns`)
- daily 의 try/catch retry 정책
- 단위 테스트 시 `callLlm` inject

## 4. DB 마이그레이션 — `0009_serious_starfox.sql`

세 테이블에 `prompt_version text NOT NULL` 컬럼 추가. 기존 행은 `'legacy-v0'` sentinel backfill — 첫 조회 시 새 promptVersion 과 mismatch 라 자동 재생성.

```sql
ALTER TABLE saju_readings
  ADD COLUMN prompt_version text NOT NULL DEFAULT 'legacy-v0';
ALTER TABLE saju_readings ALTER COLUMN prompt_version DROP DEFAULT;

ALTER TABLE saju_yearly_readings
  ADD COLUMN prompt_version text NOT NULL DEFAULT 'legacy-v0';
ALTER TABLE saju_yearly_readings ALTER COLUMN prompt_version DROP DEFAULT;

ALTER TABLE saju_daily_fortunes
  ADD COLUMN prompt_version text NOT NULL DEFAULT 'legacy-v0';
ALTER TABLE saju_daily_fortunes ALTER COLUMN prompt_version DROP DEFAULT;
```

(Drizzle 마이그레이션은 `pnpm db:generate` 로 생성 후 위 backfill DEFAULT 패턴 수동 확인. UNIQUE constraint 는 기존 그대로 — `(chartId, section)` / `(chartId, year)` / `(chartId, forDate)`.)

## 5. Prompt builder 시그니처 확장

세 prompt builder 모두 `version` 문자열을 결과에 같이 반환:

```ts
// before
export function buildReadingPrompt(input: ...): { system: string; user: string };

// after
export const READING_PROMPT_VERSION = "section-v1";
export function buildReadingPrompt(input: ...): {
  system: string;
  user: string;
  version: typeof READING_PROMPT_VERSION;
};
```

세 buildPrompt 함수 + `lib/prompts.ts`, `lib/dailyPrompt.ts`, `lib/yearlyPrompt.ts` 에 상수 export. prompt 내용을 의미 있게 바꿀 때마다 caller 가 `-v2`, `-v3` 로 올림.

## 6. Caller 리팩토링

### 6.1 `generateReading.ts` (섹션 리딩) — `cachedMarkdownReading` 사용

```ts
export async function generateReading(input: GenerateReadingInput) {
  const prompt = buildReadingPrompt({
    chart: input.chart, section: input.section, currentAge: input.currentAge,
  });
  const { data, cached } = await cachedMarkdownReading({
    table: sajuReadings,
    where: and(
      eq(sajuReadings.chartId, input.chartId),
      eq(sajuReadings.section, input.section),
    )!,
    conflictTarget: [sajuReadings.chartId, sajuReadings.section],
    prompt: { ...prompt, maxTokens: SECTION_MAX_TOKENS[input.section] },
    promptVersion: prompt.version,
    extraColumns: { chartId: input.chartId, section: input.section },
  });
  return { body: data, cached };
}
```

### 6.2 `generateYearlyReading.ts` (세운) — 동일 패턴 + 결정적 계산은 caller 안

```ts
export async function generateYearlyReading(input: GenerateYearlyReadingInput) {
  const yearPillar = computeYearPillar(input.year);
  const monthPillars = computeMonthPillars(input.year);
  const dayStem = input.chart.pillars.day.stem as Stem;
  const yearTenGods = tenGodsForPillar(dayStem, yearPillar);
  const monthTenGods = monthPillars.map((mp) => tenGodsForPillar(dayStem, mp.pillar));
  const prompt = buildYearlyPrompt({
    chart: input.chart, year: input.year,
    yearPillar, yearTenGods, monthPillars, monthTenGods,
  });
  const { data, cached } = await cachedMarkdownReading({
    table: sajuYearlyReadings,
    where: and(
      eq(sajuYearlyReadings.chartId, input.chartId),
      eq(sajuYearlyReadings.year, input.year),
    )!,
    conflictTarget: [sajuYearlyReadings.chartId, sajuYearlyReadings.year],
    prompt: { ...prompt, maxTokens: 2000 },
    promptVersion: prompt.version,
    extraColumns: {
      chartId: input.chartId, year: input.year,
      yearStem: yearPillar.stem, yearBranch: yearPillar.branch,
    },
  });
  return { body: data, cached };
}
```

### 6.3 `generateDailyFortune.ts` (일진) — 일반형 + caller 측 retry

```ts
export async function generateDailyFortune(input: GenerateDailyFortuneInput) {
  const chart = chartRowToChart(input.chartRow);
  const dayPillar = computeDayPillar(input.forDate);
  const tenGods = tenGodsForPillar(input.chartRow.dayStem as Stem, dayPillar);

  const runOnce = (retryWithEmphasis: boolean) => {
    const prompt = buildDailyPrompt({
      chart, dayPillar, tenGods, forDate: input.forDate, retryWithEmphasis,
    });
    return cachedReading<typeof sajuDailyFortunes, DailyFortunePayload>({
      table: sajuDailyFortunes,
      where: and(
        eq(sajuDailyFortunes.chartId, input.chartRow.id),
        eq(sajuDailyFortunes.forDate, input.forDate),
      )!,
      conflictTarget: [sajuDailyFortunes.chartId, sajuDailyFortunes.forDate],
      prompt: { ...prompt, maxTokens: 1500 },
      promptVersion: prompt.version,
      validator: (raw) => {
        const trimmed = raw.trim()
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "");
        return dailyFortunePayloadSchema.parse({
          ...JSON.parse(trimmed),
          dayPillar: `${dayPillar.stem}${dayPillar.branch}`,
          forDate: input.forDate,
        });
      },
      fromRow: (r) => r.payload as DailyFortunePayload,
      toRow: (payload, meta) => ({
        chartId: input.chartRow.id,
        forDate: input.forDate,
        dayStem: dayPillar.stem,
        dayBranch: dayPillar.branch,
        payload,
        model: meta.model,
        promptVersion: meta.promptVersion,
      }),
    });
  };

  try {
    const { cached } = await runOnce(false);
    return { row: null, cached };
  } catch (firstError) {
    if (firstError instanceof BudgetExceededError) throw firstError; // 재시도 무의미
    console.warn(
      `[saju.daily] first attempt failed for ${input.chartRow.id} ${input.forDate}: ${(firstError as Error).message?.slice(0, 200)}`,
    );
    const { cached } = await runOnce(true);
    return { row: null, cached };
  }
}
```

## 7. 테스트 전략 — replace, don't layer

[DEEPENING.md] 원칙: 깊은 모듈 만들면 *얕은 모듈에 붙어있던 테스트는 폐기*. 새 테스트는 깊은 모듈의 인터페이스에 작성.

### 7.1 폐기 대상

- `generateReading.test.ts` 의 cache hit / cache miss / budget assertion / spend log 검증 — 캐시-리딩 모듈로 이동.
- `generateDailyFortune.test.ts` 의 동일 분기 검증.
- `generateYearlyReading.test.ts` 의 동일 분기 검증.

### 7.2 신규 테스트 — `cachedReading.test.ts`

| 시나리오 | 검증 |
|---|---|
| cache hit (model+version 일치) | LLM 호출 안 됨, `fromRow` 반환, `cached: true` |
| cache miss — row 부재 | LLM 호출, validate, spend log, UPSERT, `cached: false` |
| cache miss — model drift | 동일 |
| cache miss — promptVersion drift | 동일 |
| Budget 초과 | `BudgetExceededError` throw, LLM 호출 안 됨 |
| Validator throw | spend log 미기록, UPSERT 미실행, throw propagate |
| LLM 호출 자체 실패 | spend log 미기록, UPSERT 미실행, throw propagate |
| `callLlm?` inject | inject된 함수가 호출됨 (단위 테스트 친화) |

DB 의존성은 `TEST_DATABASE_URL` (Gotcha #2) 패턴 따라감 — `vitest run` 시 로컬 postgres 컨테이너 띄우면 실행, 없으면 integration 13개 ECONNREFUSED skip.

### 7.3 caller-side 잔존 테스트

- `generateReading.test.ts` — prompt builder 와 caller wiring 만 검증 (mocked `cachedMarkdownReading`).
- `generateDailyFortune.test.ts` — retry 로직 (`runOnce` 두 번 호출) + retryWithEmphasis prompt 토글 + BudgetExceededError 단락만.
- `generateYearlyReading.test.ts` — 결정적 계산 호출 순서만.

각 caller 테스트는 *시퀀스* 가 아닌 *caller-specific 로직* 만 검증 → mocking 최소화 + 회귀 표면 좁아짐.

## 8. 구현 순서 (마이그레이션 안전)

1. **prompt version 상수 export** (`lib/prompts.ts`, `lib/dailyPrompt.ts`, `lib/yearlyPrompt.ts`) — builder 결과에 `version` 필드 추가. 기존 caller 영향 없음 (옵셔널 read).
2. **DB 마이그레이션 `0009_serious_starfox.sql`** — `prompt_version` 컬럼 추가 + `'legacy-v0'` backfill. 운영 DB 적용 후 코드 배포.
3. **`cachedReading.ts` 작성** + 단위 테스트 (`tests/setup.ts` 가드 통과 확인).
4. **3 caller 리팩토링** — 한 번에 한 caller씩 PR 분리 추천:
   - PR-A: `generateReading.ts` + caller 테스트 정리
   - PR-B: `generateYearlyReading.ts` + caller 테스트 정리
   - PR-C: `generateDailyFortune.ts` + caller 테스트 정리 (retry 로직 caller 측 유지 검증)
5. **운영 검증** — `/api/cron/generate-daily-fortunes` 다음 자정 cron 정상 실행 확인. 운영 DB 의 `prompt_version` 컬럼이 새 `daily-v1` 으로 갱신되는지 spot check.

## 9. 회귀 위험

- **`legacy-v0` sentinel 한 번 더 전수 재생성** — 마이그레이션 직후 첫 사이클에 모든 캐시 행이 mismatch → LLM 비용 일시 증가. 예산 가드가 잡아냄 (`SAJU_LLM_DAILY_BUDGET_KRW`). cron 이 allSettled 라 한 번에 모두 시도하다 budget 초과로 일부 실패 → 다음 날 재시도. 운영 관점에서 받아들일 만함.
- **prompt builder 시그니처 변경** — 외부에서 builder 를 직접 import 하는 caller는 현재 generate\* 함수뿐. 다른 caller 없음 확인 완료.
- **단위 테스트 폐기** — replace 원칙에 따라 의도적. 단, *caller-side wiring 테스트* 를 빠뜨리면 retry 정책 회귀를 못 잡음. 7.3 의 잔존 테스트 작성을 PR-C 에 묶어 강제.

## 10. 미해결 사항 (다음 caller 가 생길 때)

- **LLM port 정식 승격** — 두 번째 production caller (예: non-saju feature) 가 생기면 `callLlm?` 옵션을 정식 port (`LlmPort` interface + production/test adapter) 로 승격. 그 시점에 모듈을 `shared/lib/llm/cached.ts` 로 이동.
- **Telemetry / forceRegenerate / softCacheOnLlmError / mapError** — caller 요구 발생 시 옵션 백 추가. 현재 spec 에서는 의도적으로 모두 제외 (YAGNI).
- **`(model, promptVersion)` 외의 무효화 키** — 차트가 변경되어도 `(chartId)` 가 같으면 cache hit 되는 문제. 현재는 차트 자체가 바뀌면 `sajuCharts.id` 가 새로 생기므로 cascade 로 해결됨. 별도 무효화 키 불필요.
