# 사주 삼국 일운(日運) 위젯 설계 — v0.3.x

작성일: 2026-05-20
상태: Draft → User Approved (Path A) → Patched after migration 0016 discovery
선행 문서: `2026-05-19-saju-tri-monthly-daily-design.md`, `2026-05-18-saju-tri-yearly-design.md`

> **패치 노트 (2026-05-20)**: 본 spec 초안은 daily 테이블이 *없다* 전제로 작성됐으나, 구현 시작 전 검증에서 **마이그레이션 0016 이 이미 두 테이블을 만들었음**을 확인했다. 단 현재 컬럼이 monthly 와 다르고 (sections/schoolSpecific/citations/promptVersion 없음), narrative-server 도 plain text 150~300자만 생성하는 v0.3 *초기 단순화 모델* 상태다. 사용자가 **Path A (monthly 완전 동일)** 를 선택하여 spec 을 *ALTER TABLE + 코드 재작성* 방향으로 패치한다.

## 0. 문제 정의

`/fortune/[profileId]` 페이지의 사주 분석은 v0.3.x 에서 **lifetime · yearly · monthly** 세 시간 스코프에 대해 4학파(ko / cn-ziping / cn-mangpai / jp) narrative widget을 갖춘다. 사용자 요청은 동일 패턴의 **일운(日運, daily)** 을 추가하는 것이다.

현재 일운 인프라는 두 갈래로 존재한다:

1. **v0.2 단발 cron-prefill 시스템** — `entities/saju-chart` 의 `getTodayDailyFortune` + `packages/saju` 의 `dailyFortune.ts` + `widgets/saju-detail/SajuDailyFortune` + `saju_daily_fortunes` 테이블. `reading` 탭 안 한 섹션으로 표시. 4학파 분리 없음.
2. **v0.3 4학파 narrative 기반 일운 — 초기 단순화 모델 상태** — 다음이 *이미* 존재:
   - `packages/saju`: `buildTriNationDailyLiteFromBirth` + `TriNationDailyLite` + 4학파 daily adapter
   - `apps/dashboard/src/features/saju-daily-tri/`: `api/daily-server.ts`, `api/narrative-server.ts`, `lib/errorMessage.ts`, `index.ts`
   - DB 마이그레이션 `0016_nervous_galactus.sql`: `saju_daily_tri`, `saju_daily_narrative` 테이블 + Drizzle schema 정의
   - 단 monthly 와 비교하면 의도적 단순화 흔적이 남아 있다:
     - `saju_daily_narrative` 는 `prompt_version / sections_jsonb / school_specific_jsonb / citations` 컬럼 *없음*
     - `narrative-server.ts` 는 plain text 150~300자 1-2문단만 생성 (zod 스키마 없음, JSON 강제 없음, 학파 톤이 1줄 문자열)
     - prompts/schemas/UI/위젯/페이지 통합 부재

본 spec(Path A) 은 다음을 수행한다:
- (2)의 DB 스키마를 monthly 와 동일하게 *ALTER TABLE*로 보강한다 (CREATE TABLE 아님).
- `narrative-server.ts` 를 monthly 패턴 (zod schemas, JSON 강제, retry, sections, schoolSpecific) 으로 재작성한다.
- daily-server.ts 는 시그니처 유지하되 `kstTodayDate()` 를 shared helper `currentKstDate()` 로 이동한다.
- prompts.ts, schemas.ts, ui/{DailyCrossCheckBadge,DailyFrameView,TriDailyTabs} 를 신규 작성한다.
- `widgets/saju-tri-daily` + `app/fortune/[profileId]/page.tsx` daily 탭 분기를 신규 작성한다.
- `app/api/saju/daily-narrative/route.ts` 를 신규 작성한다.
- (1) 옛 시스템은 단계적으로 제거한다 (PR-A 표면 제거, PR-B 깊은 정리).

## 1. 결정 요약

| 항목 | 결정 | 근거 |
|---|---|---|
| 구현 패턴 | **monthly 1:1 미러링** (방안 A) | v0.3.x narrative 위젯은 실험 단계 — generic 추상화는 시기상조. 일관성 우선. |
| 탭 신설 | `daily` 탭 추가, `reading` 탭 안의 옛 `SajuDailyFortune` 섹션 제거 | UX 일관성 — 다른 시간 스코프와 동일하게 *탭 단위* 노출. |
| 탭 순서 | `lifetime → yearly → monthly → **daily** → chart → reading` | 대→소 시간 스케일 자연스러운 멘탈 모델. |
| Fetch 전략 | **Lazy fetch** (사용자가 탭 클릭 시 4학파 narrative 생성) | yearly/monthly와 동일. cron prefill 부하 없음. |
| Narrative 분량 | **800~1200자** (`narrativeText` zod: min 200 / max 1500, 프롬프트로 유도) | monthly와 동일 — 매일 읽기 부담 균형. |
| DB | **기존 `saju_daily_tri` 는 그대로**, **`saju_daily_narrative` 는 ALTER TABLE** 로 4 컬럼 추가 (`prompt_version`, `sections_jsonb`, `school_specific_jsonb`, `citations`) + UNIQUE INDEX 재작성. 옛 `saju_daily_fortunes` 는 Follow-up PR 에서 drop | 마이그레이션 0016 에서 v0.3 초기 모델이 이미 적용됨 — monthly 패턴으로 보강하는 형태가 가장 안전. 신규 시스템 안정 후 옛 시스템 제거. |
| 시간 키 | `for_date date` (KST YYYY-MM-DD) | DST 없음. `kstTodayDate` 패턴을 `currentKstDate()` shared helper 로 승격. |
| Sections 타입 | **`MonthlyNarrativeSections` 재사용** (`personality / career / relationship / health / daeunSummary / keyTerms / cautions`) | DRY. `daeunSummary` 는 daily 맥락에서 "오늘의 흐름 요약" 으로 재해석 (프롬프트로 유도). |

## 2. 아키텍처

### 2.1 모듈 트리

```
packages/saju/                              # 변경 없음
└── src/
    ├── compose/daily-tri.ts                # buildTriNationDailyLiteFromBirth (이미 존재)
    ├── types/daily-tri.ts                  # TriNationDailyLite, DailyLiteFrame (이미 존재)
    └── adapters/{ko,cn-ziping,cn-mangpai,jp}/daily.ts   # buildDailyLiteXxx (이미 존재)

apps/dashboard/src/
├── shared/lib/saju/
│   ├── resolveBirthInput.ts                # currentKstDate() helper 추가
│   └── tab-key.ts                          # FORTUNE_TAB_KEYS 에 "daily" 추가
│
├── features/saju-daily-tri/                # 일부 신규 / 일부 재작성
│   ├── api/
│   │   ├── daily-server.ts                 # 기존 유지 + 미세 수정 — kstTodayDate 제거 (shared helper 사용)
│   │   ├── narrative-server.ts             # 재작성 — monthly 패턴(zod + retry + sections + schoolSpecific + citations + promptVersion) 적용
│   │   ├── prompts.ts                      # 신규 — PROMPT_VERSION=1, SCHOOL_PROMPTS (학파별 BODY 일운 톤)
│   │   ├── schemas.ts                      # 신규 — 4학파 zod 스키마 (monthly 패턴)
│   │   └── schemas.test.ts                 # 신규
│   ├── ui/
│   │   ├── DailyCrossCheckBadge.tsx        # 신규
│   │   ├── DailyFrameView.tsx              # 신규
│   │   └── TriDailyTabs.tsx                # 신규 (client)
│   ├── lib/errorMessage.ts                 # 기존 유지 (이미 INVALID_DATE 포함, 보강 불필요)
│   └── index.ts                            # 기존 — export 갱신 (DailyNarrativeResult 변경 반영)
│
├── widgets/saju-tri-daily/                 # 신규
│   ├── ui/SajuTriDaily.tsx                 # RSC
│   └── index.ts
│
└── app/
    ├── api/saju/daily-narrative/route.ts   # 신규 — POST 핸들러
    └── fortune/[profileId]/page.tsx        # daily 탭 분기 + reading 탭 옛 일진 제거
```

> **확인 완료 (2026-05-20 패치)**: 기존 `daily-server.ts` 는 §2.3 시그니처와 호환 — `kstTodayDate` 를 shared helper `currentKstDate` 로 이동만 하면 미세 수정. 기존 `narrative-server.ts` 는 *완전 재작성* (plain text → JSON + zod + sections + schoolSpecific + citations + promptVersion). plan 의 첫 Task 묶음으로 이 두 변경을 박는다.

### 2.2 데이터 흐름

```
사용자 /fortune/[profileId]?tab=daily 방문
  ↓
RSC <SajuTriDaily profileId userId modelKey />
  ↓
getOrBuildDaily(profileId, userId, forDate=currentKstDate())
  ├── resolveBirthInput(profileId, userId)            ← Phase 1 helper 재사용
  ├── inputHash = sha256(birth fields | forDate)
  ├── sajuDailyTri cache lookup
  │     (profileId, forDate, inputHash, schemaVersion, algorithmVersion)   ← school 컬럼 없음 — 4학파 frame 을 한 row jsonb 에 통합
  └── miss 시 buildTriNationDailyLiteFromBirth({ input, forDate })
        → onConflictDoNothing 저장
  ↓
<DailyCrossCheckBadge triNation />                    ← RSC, server-safe
<TriDailyTabs profileId forDate triNation modelKey /> ← "use client"
  ↓ (학파 탭 활성화 시)
POST /api/saju/daily-narrative
  { profileId, school, forDate, frame, modelId }
  ↓
getOrBuildDailyNarrative(profileId, school, forDate, frame, modelId)
  ├── frameHash = sha256(JSON.stringify(frame))
  ├── sajuDailyNarrative cache lookup
  │     (profileId, school, forDate, frameHash, modelId, promptVersion, algorithmVersion)
  └── miss 시 anthropic.messages.create (ZodError 1회 재시도)
        → onConflictDoUpdate 저장
```

### 2.3 핵심 함수 시그니처

```ts
// shared/lib/saju/resolveBirthInput.ts (신규 export)
export function currentKstDate(): string;  // "YYYY-MM-DD" — KST 기준 오늘

// features/saju-daily-tri/api/daily-server.ts
export class DailyBuildError extends Error {}
export interface GetDailyResult {
  triNation: TriNationDailyLite;
  cachedAt: string;
  fromCache: boolean;
}
export async function getOrBuildDaily(
  profileId: string,
  userId: string,
  forDate: string,         // "YYYY-MM-DD" KST
): Promise<GetDailyResult>;

// features/saju-daily-tri/api/narrative-server.ts
export interface DailyNarrativeResult {
  school: NarrativeSchool;
  forDate: string;
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
  modelId: string;
  promptVersion: number;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}
export async function getOrBuildDailyNarrative(
  profileId: string,
  school: NarrativeSchool,
  forDate: string,
  frame: DailyLiteFrame,
  modelId: string,
): Promise<DailyNarrativeResult>;
```

## 3. DB 스키마

### 3.1 기존 테이블 — `saju_daily_tri` (변경 없음)

마이그레이션 `0016_nervous_galactus.sql` 에서 이미 생성됨. 본 spec 에서 변경 없음.

```sql
-- (기존 0016 정의 — 참고용)
CREATE TABLE saju_daily_tri (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  for_date          date NOT NULL,
  input_hash        text NOT NULL,
  schema_version    integer NOT NULL,
  algorithm_version integer NOT NULL DEFAULT 1,
  frame_jsonb       jsonb NOT NULL,           -- TriNationDailyLite (4학파 frame 통합)
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX saju_daily_tri_cache_key
  ON saju_daily_tri (profile_id, for_date, input_hash, schema_version, algorithm_version);
CREATE INDEX saju_daily_tri_profile_idx ON saju_daily_tri (profile_id, for_date);
CREATE INDEX saju_daily_tri_date_idx ON saju_daily_tri (for_date);
```

> **monthly 와 차이**: `school` 컬럼 없음 — 4학파 frame 을 한 row 의 `frame_jsonb` 에 통합. v0.3 daily 설계의 의도적 단순화 (`packages/saju/src/types/daily-tri.ts` 코멘트 참조). 본 spec 은 이 구조를 유지.

### 3.2 기존 테이블 — `saju_daily_narrative` (ALTER TABLE 로 보강)

마이그레이션 `0016` 에서 v0.3 *초기 plain-text 모델*로 생성됨. monthly 패턴으로 맞추기 위해 **새 마이그레이션 (이번 PR) 에서 4 컬럼 추가 + UNIQUE INDEX 재작성**.

#### 기존 컬럼 (0016 적용분)

```sql
-- (참고용 — 변경 안 함)
id, profile_id, school, for_date, frame_hash, model_id,
algorithm_version, narrative_text, generated_at
-- UNIQUE INDEX (profile_id, school, for_date, frame_hash, model_id, algorithm_version)
```

#### 추가 컬럼 (이번 PR 마이그레이션)

```sql
-- 이번 PR 의 새 마이그레이션 — 최종 번호는 drizzle-kit generate 결과 (현재 최신 0018 → 0019 예상)
ALTER TABLE saju_daily_narrative
  ADD COLUMN prompt_version       integer NOT NULL DEFAULT 1,
  ADD COLUMN sections_jsonb       jsonb,                       -- nullable: monthly 와 동일 (자가 치유 패턴)
  ADD COLUMN school_specific_jsonb jsonb,                      -- nullable: 위와 동일
  ADD COLUMN citations            text[] NOT NULL DEFAULT '{}'::text[];

-- 기존 UNIQUE INDEX drop 후 prompt_version 포함하여 재생성
DROP INDEX saju_daily_narrative_cache_key;
CREATE UNIQUE INDEX saju_daily_narrative_cache_key
  ON saju_daily_narrative (profile_id, school, for_date, frame_hash, model_id, prompt_version, algorithm_version);
```

> **`sections_jsonb` 와 `school_specific_jsonb` 를 nullable 로 두는 이유**: 0016 에서 만들어진 기존 row 들 (v0.3 plain-text 모델) 이 이미 존재할 수 있다. NOT NULL 강제하면 ALTER 가 실패한다. monthly 의 `narrative-server.ts` 도 *null cached row → regen* 자가 치유 분기를 갖고 있어 (yearly/lifetime 패턴) 동일하게 처리.
>
> **PROMPT_VERSION=1 (신규)**: 캐시 키에 `prompt_version=1` 이 들어가므로 기존 plain-text row (prompt_version DEFAULT 1) 와 신규 sections-rich row 는 동일 키를 만들 수 있다. 이를 해결하기 위해 `narrative-server.ts` 의 cache lookup 에서 `sections_jsonb IS NOT NULL` 조건도 함께 확인하거나, *기존 plain-text row 를 백필/삭제*하는 것이 안전. **결정: ALTER 와 함께 기존 row 를 DELETE** (마이그레이션에 포함):
>
> ```sql
> -- 기존 plain-text row 청소 — 신규 모델로 캐시 자동 재생성 (lazy regen).
> DELETE FROM saju_daily_narrative;
> ```
>
> daily narrative 는 매일 행 단위로 자연 재생성되므로 손실 영향 미미 (오늘 첫 방문 시 새로 빌드).

### 3.3 마이그레이션 분할

- **PR-A (이번 PR)**: `apps/dashboard/drizzle/<next>_saju_daily_narrative_richer.sql` — 위 ALTER TABLE + DROP INDEX + CREATE UNIQUE INDEX + DELETE. **현재 최신은 `0018_silent_compose_fix.sql`** 이라 `drizzle-kit generate` 결과 `0019_...` 가 될 가능성 높지만, drizzle-kit 이 자동 부여하므로 PR 시점 번호를 따른다. ALTER 만 한다 (옛 `saju_daily_fortunes` 는 건드리지 않음).
- **PR-B (Follow-up, 며칠 후)**: `<next+1>_drop_saju_daily_fortunes.sql` — `DROP TABLE saju_daily_fortunes`. 신규 시스템 운영 안정성 확인 후 진행.

> **drizzle-kit 자동 생성 한계**: drizzle-kit 은 Drizzle schema 변경을 감지해 ALTER 를 생성하지만, `DROP INDEX` 후 `CREATE UNIQUE INDEX` 재작성과 `DELETE FROM` 는 자동 생성 안 됨. 생성된 `.sql` 파일을 손으로 추가 편집해 두 statement 를 박는다 (`drizzle-kit` 의 "수동 append" 패턴 — 0016 의 CHECK 추가와 동일 방식).

### 3.4 캐시 자가 치유

| 테이블 | 충돌 정책 | 근거 |
|---|---|---|
| `saju_daily_tri` | `onConflictDoNothing` | frame 빌드는 deterministic — 동시 miss 무해 |
| `saju_daily_narrative` | `onConflictDoUpdate(set narrativeText, sectionsJsonb, schoolSpecificJsonb, citations, generatedAt)` | LLM variance — 늦은 결과로 갱신 |

### 3.5 캐시 만료/정리

명시적 만료 없음. `for_date` 가 키이므로 매일 새 row 누적. 1년 매일 × 5학파(compose+4) = ~1825 row/사용자 — 운영 부하 무시 가능. TTL 정책이 필요해지면 v0.4 별도 작업.

## 4. UI 컴포넌트

### 4.1 `<DailyCrossCheckBadge triNation />` (RSC)

monthly의 `MonthlyCrossCheckBadge` 미러. 표시:
- **overallVibe** chip (auspicious=녹 / inauspicious=적 / neutral=회)
- **dayGanji** — 4학파가 동일하면 1번 표시 (운영상 거의 동일), 다르면 학파별
- **scope label** — "오늘 (YYYY-MM-DD)"

### 4.2 `<DailyFrameView frame />` (props-only)

학파별 frame 표시. `DailyLiteFrame` 구조에 맞춰 단순:
- 학파명 + 일진 간지
- dayVibe chip
- hints 리스트 (1~3개)

### 4.3 `<TriDailyTabs profileId forDate triNation modelKey />` ("use client")

`TriMonthlyTabs` 1:1 미러:
- Radix Tabs (ko / cn-ziping / cn-mangpai / jp)
- 각 탭 panel = `<DailyFrameView>` + `<NarrativeBlock>` (TanStack Query lazy fetch)
- Query key: `["daily-narrative", profileId, forDate, school, modelKey]`
- 첫 탭 활성 시 자동 fetch, 나머지는 클릭 시 lazy
- Narrative 표시: `narrativeText` 3문단 + sections grid + keyTerms chips + cautions bullet + schoolSpecific 박스 + citations footer

### 4.4 `<SajuTriDaily profileId userId modelKey />` (RSC)

`SajuTriMonthly` 1:1 미러. `.then(success, failure)` discriminated union → JSX 분기 (memory `react-error-boundaries-lint-rule` 준수). 헤딩 "삼국 관점 {forDate} 일운".

## 5. 페이지 통합 (`app/fortune/[profileId]/page.tsx`)

### 5.1 변경 diff 요약

```diff
- import { getTodayDailyFortune } from "@/entities/saju-chart";
+ import { SajuTriDaily } from "@/widgets/saju-tri-daily";
- import { SajuDailyFortune, ... } from "@/widgets/saju-detail";
+ import { /* SajuDailyFortune 제거, 나머지 유지 */ } from "@/widgets/saju-detail";
- import type { ..., DailyFortunePayload, ... } from "@gons/saju";
+ import type { ..., /* DailyFortunePayload 제거 */ } from "@gons/saju";

- function kstTodayDate(): string { ... }
+ // currentKstDate() in shared helper

- const [yearlyResult, dailyRow] = await Promise.all([
-   generateYearlyReading(...).then(...),
-   getTodayDailyFortune(chart.id, kstTodayDate()).catch(() => null),
- ]);
+ const yearlyResult = await generateYearlyReading(...).then(...);

+ {activeTab === "daily" && (
+   <TabPanel tabKey="daily" idPrefix={FORTUNE_TAB_PREFIX}>
+     <Suspense fallback={<TabSkeleton />}>
+       <SajuTriDaily profileId={profileId} userId={session.user.id} modelKey={modelKey} />
+     </Suspense>
+   </TabPanel>
+ )}

- {dailyRow && (
-   <section aria-labelledby="daily-heading" ...>
-     <h2>오늘 일진</h2>
-     <SajuDailyFortune payload={dailyRow.payload as DailyFortunePayload} dayPillar={...} />
-   </section>
- )}
```

### 5.2 Tab 키 등록 (`shared/lib/saju/tab-key.ts`)

```diff
 export const FORTUNE_TAB_KEYS = [
   "lifetime",
   "yearly",
   "monthly",
+  "daily",
   "chart",
   "reading",
 ] as const;

 export const FORTUNE_TAB_META = {
   lifetime: { label: "일대" },
   yearly:   { label: "세운" },
   monthly:  { label: "월운" },
+  daily:    { label: "일운" },
   chart:    { label: "사주" },
   reading:  { label: "해설" },
 } satisfies Record<FortuneTabKey, { label: string }>;
```

> **참고**: page.tsx의 활성탭 분기는 현재 if-체인 방식이라 `daily` 분기를 *추가하지 않으면 컴파일은 통과하지만 런타임에 빈 화면*이 된다. spec/plan에서 누락 방지 체크리스트 항목으로 명시. (탭 키별 컴포넌트 매핑을 typed dict로 바꾸는 리팩토링은 본 스코프 외 — v0.4 후보.)

## 6. API Route — `/api/saju/daily-narrative`

monthly `/api/saju/monthly-narrative` 1:1 미러. POST 핸들러:

| 입력 (zod) | 인증 | 처리 | 응답 |
|---|---|---|---|
| `{ profileId: uuid, school: NarrativeSchool, forDate: YYYY-MM-DD (KST 오늘만 허용), frame: DailyLiteFrame, modelId: string }` | NextAuth session → userId 필수 | `getOrBuildDailyNarrative()` 호출 | `DailyNarrativeResult` JSON |

에러 매핑:
- 인증 없음 → 401
- profile 없음 / 다른 사용자 → 404
- `forDate ≠ currentKstDate()` (드리프트 방지) → 400
- `DailyBuildError` → 422
- LLM/Zod/DB → 500

## 7. 옛 시스템 처리

> **2026-05-20 패치 — 대시보드 FortuneCard 발견**: 구현 시작 전 검증에서 옛 `SajuDailyFortune` 위젯이 *page.tsx 외*에 **대시보드 메인 면의 `FortuneCardClient.tsx`** (대시보드 카드 그리드, profile select + 오늘 일진 카드)에서도 사용 중임을 확인. 옛 `getTodayDailyFortunesForUser` (복수형) 도 `FortuneCard.tsx` 에서 사용. *이 카드는 daily 탭과 다른 도메인* (간략 카드 vs 상세 분석) 이므로 옛 시스템을 모두 제거하면 *대시보드 회귀*가 발생. 사용자가 **Path B (대시보드 FortuneCard 보존)** 선택. PR-A 범위는 *daily 탭 + reading 탭 안의 옛 섹션* 만으로 좁힌다.

### 7.1 PR-A (이번 PR) — fortune 페이지 reading 탭 안의 옛 일진 섹션만 제거

- `apps/dashboard/src/app/fortune/[profileId]/page.tsx`:
  - `getTodayDailyFortune` import 제거
  - `dailyRow` Promise.all fetch 제거 + `kstTodayDate()` 로컬 함수 제거
  - reading 탭 안 `{dailyRow && (...)}` 섹션 JSX 제거
  - daily 탭 (`SajuTriDaily`) 분기 신규 추가
- `apps/dashboard/src/widgets/saju-detail/index.ts`: **변경 없음** — `SajuDailyFortune` export 유지 (FortuneCardClient 가 의존)
- `apps/dashboard/src/widgets/saju-detail/ui/SajuDailyFortune.tsx`: **파일 유지** — FortuneCardClient 가 직접/간접 사용
- `apps/dashboard/tests/saju-cron-daily.integration.test.ts`: **변경 없음** — cron-prefill 시스템이 FortuneCard 위해 살아 있음

### 7.2 PR-B (Follow-up, 별도 시점) — 대시보드 FortuneCard 자체 v0.3 재설계 (별도 spec 필요)

옛 cron-prefill + `SajuDailyFortune` 시스템 자체를 PR-A 가 건드리지 않으므로 PR-B 는 별도 spec/plan 으로 다룬다 — 대시보드 FortuneCard 가 새 daily-narrative API 를 어떻게 부분 활용할지 (예: profile×4학파 카드 vs 단일 학파 단일 카드 vs 옛 시스템 유지) 결정 필요.

따라서 본 PR-A 의 명시적 제외:
- `entities/saju-chart/api/getTodayDailyFortune.ts` 제거 → PR-B
- `entities/saju-chart/api/getTodayDailyFortunesForUser.ts` 제거 → PR-B
- `packages/saju/src/dailyFortune.ts` 제거 → PR-B
- `packages/saju/src/types/daily.ts` (`DailyFortunePayload`) 제거 → PR-B
- `apps/cron` daily prefill job 정리 → PR-B
- `saju_daily_fortunes` 테이블 drop → PR-B

## 8. 에러 처리

### 8.1 RSC 에러 전파

memory `react-error-boundaries-lint-rule` 준수 — `try/catch` 안에서 JSX 생성 금지. `.then(success, failure)` discriminated union 패턴.

### 8.2 에러 클래스

| 에러 | 발생 | HTTP | UI |
|---|---|---|---|
| `ProfileNotFoundError` | profile 조회 실패 / 다른 사용자 | 404 | "프로필을 찾을 수 없습니다" |
| `DailyBuildError` | `BirthInputValidationError`, `buildTriNationDailyLiteFromBirth` Result.error (LIBRARY_MISMATCH 등) | 422 | `toUserMessage(error.message)` |
| `ZodError` (after retry) | LLM schema 불일치 | 500 | "학파 분석 결과가 schema 검증에 실패했습니다" |
| JSON parse fail | LLM 응답 형식 오류 | 500 | "응답 형식이 잘못되었습니다" |
| Anthropic API fail | LLM 호출 실패 | 500 | "LLM 호출 실패 — 잠시 후 재시도" |
| DB 실패 | drizzle | 500 | "내부 오류가 발생했습니다" |

### 8.3 학파별 isolation

TanStack Query 학파별 key 분리로 한 학파 narrative 실패가 다른 학파 panel에 영향 없음. 사용자는 다른 학파 탭에서 정상 결과 확인 가능.

## 9. 테스트

### 9.1 신규 단위 테스트

- `features/saju-daily-tri/api/schemas.test.ts` — 4학파 zod 스키마 (monthly schemas.test.ts 미러)
- `shared/lib/saju/resolveBirthInput.test.ts` 에 `currentKstDate()` 케이스 추가 — KST offset, 자정 경계

### 9.2 신규 통합 테스트 (DB 필요, `TEST_DATABASE_URL`)

- `features/saju-daily-tri/api/daily-server.test.ts` — `getOrBuildDaily` cache miss/hit, `DailyBuildError` 변환
- `features/saju-daily-tri/api/narrative-server.test.ts` — ZodError 재시도, `onConflictDoUpdate` 자가 치유

### 9.3 신규 E2E 통합 테스트

- `apps/dashboard/tests/saju-daily-narrative.integration.test.ts` — POST `/api/saju/daily-narrative` 인증/캐시/에러

### 9.4 옛 테스트 삭제

- `apps/dashboard/tests/saju-cron-daily.integration.test.ts` — 옛 cron-prefill 시스템과 함께 제거

### 9.5 회귀 검증

- `pnpm typecheck` — 타입 안전
- `pnpm lint` — FSD boundary + react-hooks/error-boundaries
- `pnpm test` — 신규 단위 + 통합 통과
- `pnpm build` — 운영 빌드 통과
- 브라우저 검증 — daily 탭 클릭 → 4학파 narrative lazy load → cache hit 즉시 → 자정 경계 후 새 forDate row 생성

## 10. 운영 적용

### 10.1 마이그레이션

```bash
cd apps/dashboard
pnpm db:generate              # 새 SQL 생성 (0019 예상) — DROP/CREATE INDEX + DELETE 수동 append
pnpm db:migrate \
  --i-know-this-is-prod       # 192.168.0.5:5440 적용
```

### 10.2 배포 검증 (memory `docker-deploy-verify-pattern`)

```bash
gh run watch                                              # Build & Push
docker --context home-server compose -f $COMPOSE pull app cron
docker --context home-server compose -f $COMPOSE up -d app cron
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"
```

API 라우트 검증:
- `POST /api/saju/daily-narrative` 인증 없이 → 401
- `GET /fortune/[profileId]?tab=daily` 로그인 후 → 200 + 4학파 lazy load

### 10.3 Rollback 전략

- **PR-A revert**: 코드 revert + 보강 컬럼 4 개 drop (`ALTER TABLE saju_daily_narrative DROP COLUMN prompt_version, DROP COLUMN sections_jsonb, DROP COLUMN school_specific_jsonb, DROP COLUMN citations;`) + UNIQUE INDEX 원상복구 (`(profile_id, school, for_date, frame_hash, model_id, algorithm_version)`). 0016 의 plain-text 모델로 복귀. 옛 시스템 (`saju_daily_fortunes` + `SajuDailyFortune` 위젯) 그대로 살아있음.
- **PR-B revert**: `saju_daily_fortunes` 테이블 복원 (백업 필요) + 옛 코드 git revert. 신규 시스템과 공존 가능 (서로 독립).

## 11. 명시적 Out-of-Scope

- Daily narrative cron prefill (사용자 활동 기반 opt-in 알림은 v0.4 후보)
- 미래 날짜 일운 분석 (`forDate` 는 KST 오늘로 제한)
- Daily narrative 이력 페이지 ("지난 일주일 일운 모음")
- Daily 분량 증액 (lifetime/yearly 처럼 1500~2000자로) — 추후 사용자 피드백 기반
- `MonthlyNarrativeSections` 를 `NarrativeSections` 로 rename (다른 위젯과 함께 v0.4 generic 추상화 시점에 일괄)

## 12. 변경되지 않는 부분 (명시)

- `packages/saju` 의 daily-tri compose/types/adapters — 그대로 사용
- yearly/monthly 위젯·서버 코드 — 영향 없음
- lifetime 위젯·서버 코드 — 영향 없음
- 옛 `saju_daily_fortunes` 테이블 데이터 — PR-A 에서 건드리지 않음 (PR-B 에서 drop)
- Tiger consult 일운 (`features/tiger-consult/api/dailyFortune.ts`) — 별도 시스템, 영향 없음 (다만 PR-B 에서 `packages/saju/src/dailyFortune.ts` 제거 시 tiger-consult 가 의존하는지 grep 검증 필요)
