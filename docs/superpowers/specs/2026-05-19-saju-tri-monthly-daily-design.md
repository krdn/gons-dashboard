---
title: 사주 삼국 분석 v0.3 — 월운(月運) + tri 일진(日辰) 설계
date: 2026-05-19
status: design
related:
  - docs/superpowers/specs/2026-05-18-saju-tri-yearly-design.md (v0.2)
  - docs/superpowers/plans/2026-05-18-saju-tri-yearly-implementation.md (v0.2 plan)
decisions:
  D1: "월운 범위 = 현재 월 1개"
  D2: "tri 일진 = 4학파 일진 간지 대 용신 충합 + LLM narrative"
  D3: "월운 + tri 일진 = v0.3 하나에 뿐기"
  D4: "tri 일진 DB = 신규 테이블 saju_daily_tri + saju_daily_narrative"
  D5: "tri 일진 cron = 신규 라우트 generate-daily-tri-fortunes"
  D6: "일진 분석 심도 = 간지 대 용신 충합 (YearlyFrame 대비 단순화)"
  D7: "getOrBuild factory 추출 = v0.3에서 바로 createTriCacheHandler"
---

# 사주 삼국 분석 v0.3 — 월운(月運) + tri 일진(日辰) 설계

## 1. 배경

v0.2 (년운 + 용신)가 2026-05-18 shipped. v0.2 spec §2.2 Out-of-scope로 명시된
"월운(月運) / 일운(日運)"을 v0.3에서 구현한다.

v0.2 yearly 파이프라인이 완전히 정립되어 있으므로 v0.3은 그 패턴을 최대한 재사용하고
일진만 별도 특성(매일 cron + 단순 frame)을 반영해 분기한다.

## 2. 범위

### 2.1 In-scope (v0.3)

- **월운(月運)**: 현재 KST 월의 4학파 월운 분석
  - `MonthlyFrame` 타입 + 4학파 어댑터 (`adapters/*/monthly.ts`)
  - `buildTriNationMonthly()` compose
  - API 2종: `/api/saju/monthly/[profileId]`, `.../narrative`
  - DB 2테이블: `saju_monthly_tri`, `saju_monthly_narrative`
  - UI 위젯: `SajuTriMonthly` — yearly 위젯 아래 배치
  - `createTriCacheHandler` factory 추출 (getOrBuild 공통화)

- **tri 일진(日辰)**: 4학파별 일진 간지 대 용신 충합 + LLM narrative
  - `TriNationDailyLite` 타입 (YearlyFrame 대비 단순화)
  - 4학파 어댑터 (`adapters/*/daily.ts`)
  - `buildTriNationDailyLite()` compose
  - DB 2테이블: `saju_daily_tri`, `saju_daily_narrative`
  - cron 신규 라우트: `generate-daily-tri-fortunes` (기존 `generate-daily-fortunes` 유지)
  - UI 위젯: `SajuTriDaily` — fortune 페이지에 별도 섹션으로 배치

### 2.2 Out-of-scope (v0.4 이후)

- 12개월 전체 월운 + 월 선택기 — v0.4
- 과거/미래 특정 날짜 일진 — v0.4
- tri 일진과 기존 `saju_daily_fortunes` 통합/폐기 — 사용자 적응 후 v0.4 결정
- 궁합(宮合) — v0.4
- JP 학파 daily verdict 개선 (항상 neutral 문제) — v0.4

## 3. 기술 설계

### 3.1 파이프라인 비교

```
v0.2 Yearly 파이프라인
─────────────────────────────────────
BirthInput → chart + daeun
  → buildYongshin{School}()
  → buildYearly{School}({ chart, daeun, targetYear, yongShin, currentAge })
  → buildTriNationYearly({ chart, daeun, targetYear, currentAge })
  → getOrBuildYearly(profileId, userId, targetYear)
  → /api/saju/yearly/[profileId]
  → SajuTriYearly (RSC)

v0.3 Monthly 파이프라인 (yearly와 동일 구조)
─────────────────────────────────────
BirthInput → chart + daeun
  → buildYongshin{School}()  ← 재사용
  → buildMonthly{School}({ chart, daeun, targetYear, targetMonth, yongShin, currentAge })
  → buildTriNationMonthly({ chart, daeun, targetYear, targetMonth, currentAge })
  → getOrBuildMonthly(profileId, userId, targetYear, targetMonth)
    └─ createTriCacheHandler 공통 factory 사용
  → /api/saju/monthly/[profileId]?year=YYYY&month=MM
  → SajuTriMonthly (RSC)

v0.3 Tri Daily 파이프라인 (단순화된 frame)
─────────────────────────────────────
BirthInput → chart
  → buildYongshin{School}()  ← 재사용
  → buildDailyLite{School}({ chart, dayPillar, yongShin })
      ※ daeun 불필요 — 일진은 당일 간지 대 용신 충합만 판단
  → buildTriNationDailyLite({ chart, forDate })
  → generateDailyTriFortune({ chartRow, forDate })
  → /api/cron/generate-daily-tri-fortunes (자정 KST)
  → SajuTriDaily (RSC or client)
```

### 3.2 MonthlyFrame 타입 설계

```typescript
// packages/saju/src/types/monthly.ts

export interface MonthlyFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  targetYear: number;
  targetMonth: number;   // 1..12 (KST)

  // 월운 간지 (computeMonthPillars 기반)
  monthGanji: { stem: Stem; branch: Branch };

  // 현재 대운 (yearly와 동일)
  currentDaeun: {
    startAge: number;
    endAge: number;
    ganji: { stem: Stem; branch: Branch };
  };

  // 용신 대비 월운 충합 판정 (yearly yongShinDelta와 동일 구조)
  yongShinDelta: {
    netVerdict: "favorable" | "unfavorable" | "mixed";
    details: string[];
  };

  // 학파별 월운 해석 힌트 (LLM narrative 프롬프트용)
  interpretationHints: string[];
}

export interface TriNationMonthly {
  targetYear: number;
  targetMonth: number;
  frames: {
    ko: MonthlyFrame;
    cnZiping: MonthlyFrame;
    cnMangpai: MonthlyFrame;
    jp: MonthlyFrame;
  };
  crossCheck: {
    agreement: "high" | "medium" | "low";
    notes: string[];
  };
}
```

### 3.3 TriNationDailyLite 타입 설계

```typescript
// packages/saju/src/types/daily-tri.ts

export interface DailyLiteFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  forDate: string;         // YYYY-MM-DD

  // 일진 간지
  dayGanji: { stem: Stem; branch: Branch };

  // 용신 대비 일진 충합 — 단순 판정 (YearlyFrame보다 경량)
  dayVibe: "auspicious" | "inauspicious" | "neutral";

  // 학파별 해석 힌트 (LLM에게 전달)
  hints: string[];
}

export interface TriNationDailyLite {
  forDate: string;
  frames: {
    ko: DailyLiteFrame;
    cnZiping: DailyLiteFrame;
    cnMangpai: DailyLiteFrame;
    jp: DailyLiteFrame;
  };
  overallVibe: "auspicious" | "inauspicious" | "neutral";  // 3/4 합의 기준
}
```

### 3.4 createTriCacheHandler factory

v0.2 `getOrBuildYearly`와 `getOrBuildMonthly`가 공유하는 캐시 패턴을 추출:

```typescript
// apps/dashboard/src/shared/lib/tri/createTriCacheHandler.ts

interface TriCacheHandlerOptions<T, CacheRow> {
  buildFrame: (args: BuildArgs) => T;
  getCacheKey: (args: BuildArgs) => CacheKeyParts;
  findCached: (key: CacheKeyParts, db: DB) => Promise<CacheRow | null>;
  insertCache: (frame: T, key: CacheKeyParts, db: DB) => Promise<void>;
  schemaVersion: number;
}

// 반환: getOrBuild(profileId, userId, ...extra) => Promise<T>
export function createTriCacheHandler<T, CacheRow>(
  opts: TriCacheHandlerOptions<T, CacheRow>
): (profileId: string, userId: string, ...extra: unknown[]) => Promise<T>
```

### 3.5 DB 마이그레이션 (4테이블 신규)

```sql
-- saju_monthly_tri: TriNationMonthly 결정형 캐시
CREATE TABLE saju_monthly_tri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school TEXT NOT NULL CHECK (school IN ('ko','cn-ziping','cn-mangpai','jp')),
  target_year INTEGER NOT NULL,
  target_month INTEGER NOT NULL CHECK (target_month BETWEEN 1 AND 12),
  input_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  frame_jsonb JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX saju_monthly_tri_cache_key
  ON saju_monthly_tri(profile_id, school, target_year, target_month, input_hash, schema_version);
CREATE INDEX saju_monthly_tri_profile_idx
  ON saju_monthly_tri(profile_id, target_year, target_month);

-- saju_monthly_narrative: LLM 서술 캐시
CREATE TABLE saju_monthly_narrative (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school TEXT NOT NULL,
  target_year INTEGER NOT NULL,
  target_month INTEGER NOT NULL,
  frame_hash TEXT NOT NULL,
  model_id TEXT NOT NULL,
  narrative_text TEXT NOT NULL,
  sections_jsonb JSONB NOT NULL,
  citations TEXT[] NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX saju_monthly_narrative_cache_key
  ON saju_monthly_narrative(profile_id, school, target_year, target_month, frame_hash, model_id);

-- saju_daily_tri: TriNationDailyLite 결정형 캐시
CREATE TABLE saju_daily_tri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  for_date DATE NOT NULL,
  input_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  frame_jsonb JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX saju_daily_tri_cache_key
  ON saju_daily_tri(profile_id, for_date, input_hash, schema_version);
CREATE INDEX saju_daily_tri_date_idx ON saju_daily_tri(for_date);

-- saju_daily_narrative: tri 일진 LLM 서술 캐시 (학파별)
CREATE TABLE saju_daily_narrative (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school TEXT NOT NULL,
  for_date DATE NOT NULL,
  frame_hash TEXT NOT NULL,
  model_id TEXT NOT NULL,
  narrative_text TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX saju_daily_narrative_cache_key
  ON saju_daily_narrative(profile_id, school, for_date, frame_hash, model_id);
```

### 3.6 신규 파일 목록

```
packages/saju/src/
  types/monthly.ts                                 (신규)
  types/daily-tri.ts                               (신규)
  adapters/ko/monthly.ts                           (신규)
  adapters/cn-ziping/monthly.ts                    (신규)
  adapters/cn-mangpai/monthly.ts                   (신규)
  adapters/jp/monthly.ts                           (신규)
  adapters/ko/daily.ts                             (신규)
  adapters/cn-ziping/daily.ts                      (신규)
  adapters/cn-mangpai/daily.ts                     (신규)
  adapters/jp/daily.ts                             (신규)
  compose/monthly.ts                               (신규)
  compose/daily-tri.ts                             (신규)
  compose/monthly.wrapper.ts                       (신규, yearly.wrapper 패턴)

apps/dashboard/src/
  shared/lib/tri/createTriCacheHandler.ts          (신규, D7)
  features/saju-monthly-tri/
    api/monthly-server.ts                          (신규)
    api/narrative-server.ts                        (신규)
    lib/errorMessage.ts                            (신규)
    ui/TriMonthlyTabs.tsx                          (신규)
    ui/MonthlyFrameView.tsx                        (신규)
    ui/MonthlyCrossCheckBadge.tsx                  (신규)
    index.ts                                       (신규)
  features/saju-daily-tri/
    api/daily-server.ts                            (신규)
    api/narrative-server.ts                        (신규)
    ui/TriDailyTabs.tsx                            (신규)
    ui/DailyFrameView.tsx                          (신규)
    index.ts                                       (신규)
  widgets/saju-tri-monthly/
    ui/SajuTriMonthly.tsx                          (신규)
    index.ts                                       (신규)
  widgets/saju-tri-daily/
    ui/SajuTriDaily.tsx                            (신규)
    index.ts                                       (신규)
  app/api/saju/monthly/[profileId]/
    route.ts                                       (신규)
  app/api/saju/monthly/[profileId]/narrative/
    route.ts                                       (신규)
  app/api/cron/generate-daily-tri-fortunes/
    route.ts                                       (신규)
  shared/lib/db/schema.ts                          (수정 — 4테이블 추가)
  app/fortune/[profileId]/page.tsx                 (수정 — SajuTriMonthly + SajuTriDaily 추가)
```

총 신규 파일: ~28개, 수정 파일: 2개

### 3.7 Phase 계획 (v0.2 6-phase 패턴 재사용)

| Phase | 내용 | 완료 기준 |
|-------|------|----------|
| Phase 0 | DB 마이그레이션 (4테이블) | `pnpm db:migrate` 성공 |
| Phase 1 | `createTriCacheHandler` factory + yearly 리팩터 | 기존 getOrBuildYearly가 factory로 리팩터 + 테스트 통과 |
| Phase 2 | monthly 어댑터 4개 + compose | golden test 4개 통과 |
| Phase 3 | monthly API 2종 + feature layer | typecheck + lint 0 |
| Phase 4 | tri daily 어댑터 4개 + compose | golden test 4개 통과 |
| Phase 5 | tri daily cron + feature layer | cron integration test 통과 |
| Phase 6 | UI 위젯 2개 + fortune page 통합 | 브라우저 UI 검증 |
| Phase 7 | 테스트 보완 + 회귀 fixture | monthly 5건 + daily 5건 fixture |

## 4. 알려진 위험

| 위험 | 심각도 | 대응 |
|------|--------|------|
| tri 일진 cron 비용 4배 증가 (단일 → 4학파 narrative) | 중 | concurrency=2 유지 + 4학파 병렬 처리로 실행 시간 단축 |
| createTriCacheHandler 추상화 과도 | 중 | generic 타입 최소화, 2개 이상 실제 재사용 시에만 추출 |
| JP 학파 daily verdict 항상 neutral | 중 | Phase 4 golden test에서 관찰 + spec 주석으로 명시 |
| monthPillars 절기 시작일 근사 (15일 기준) | 저 | "절기 기준" 사용자에게 명시 |
| saju_daily_fortunes 기존 cron과의 UX 중복 | 저 | 기존 `SajuDailyFortune` 유지 + `SajuTriDaily` 별도 섹션 병렬 노출 |

## 5. 테스트 계획

### packages/saju 테스트
- `monthly.wrapper.test.ts` — `buildTriNationMonthlyFromBirth` golden snapshot
- `monthly.regression.test.ts` — 5개 프로파일 × 현재 월 fixture
- `daily-tri.test.ts` — `buildTriNationDailyLite` golden snapshot
- `daily-tri.regression.test.ts` — 5개 프로파일 × 5일 fixture

### apps/dashboard 테스트
- `saju-monthly-api.integration.test.ts` — 401, 404, 422, month 파라미터 검증
- `saju-daily-tri-cron.integration.test.ts` — saju-cron-daily 패턴 재사용

## 6. NOT in scope (명시적 제외)

- 12개월 선택기 — v0.4
- 과거/미래 날짜 tri 일진 — v0.4
- 기존 `saju_daily_fortunes` 폐기/통합 — v0.4 결정
- JP 학파 daily verdict 개선 — v0.4
- 월운 + 일진 응기(應期) 신살(神煞) 심화 — v0.5

## 7. What already exists (재사용 목록)

| 기존 코드 | 위치 | v0.3 재사용 방식 |
|-----------|------|----------------|
| `computeMonthPillars(year)` | `packages/saju/src/monthPillars.ts` | monthly adapter에서 월간지 계산 |
| `computeDayPillar(date)` | `packages/saju/src/dayPillar.ts` | daily adapter에서 일진 계산 |
| `buildYongshin{School}()` | `adapters/*/yongshin.ts` | monthly + daily adapter 전부 재사용 |
| `verifyConsensus()` | `consensus/index.ts` | monthly wrapper에서 재사용 |
| `createCronHandler` | `shared/lib/cron/createCronHandler.ts` | tri daily cron 라우트 |
| `saju_yearly_tri` 패턴 | DB schema | monthly/daily 테이블 동일 구조 |
| `TriYearlyTabs` + `YearlyFrameView` | `features/saju-yearly-tri/ui/` | monthly UI 복제 기반 |
| `yearly-server.ts` rate limit | `features/saju-yearly-tri/api/` | monthly narrative에서 동일 패턴 |
