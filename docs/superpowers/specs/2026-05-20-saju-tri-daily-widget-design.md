# 사주 삼국 일운(日運) 위젯 설계 — v0.3.x

작성일: 2026-05-20
상태: Draft → User Review
선행 문서: `2026-05-19-saju-tri-monthly-daily-design.md`, `2026-05-18-saju-tri-yearly-design.md`

## 0. 문제 정의

`/fortune/[profileId]` 페이지의 사주 분석은 v0.3.x 에서 **lifetime · yearly · monthly** 세 시간 스코프에 대해 4학파(ko / cn-ziping / cn-mangpai / jp) narrative widget을 갖춘다. 사용자 요청은 동일 패턴의 **일운(日運, daily)** 을 추가하는 것이다.

현재 일운 인프라는 두 갈래로 존재한다:

1. **v0.2 단발 cron-prefill 시스템** — `entities/saju-chart` 의 `getTodayDailyFortune` + `packages/saju` 의 `dailyFortune.ts` + `widgets/saju-detail/SajuDailyFortune` + `saju_daily_fortunes` 테이블. `reading` 탭 안 한 섹션으로 표시. 4학파 분리 없음.
2. **v0.3 4학파 narrative 기반 일운 — 절반만 존재** — `packages/saju` 의 `buildTriNationDailyLiteFromBirth` + `TriNationDailyLite` + 4학파 daily adapter + `features/saju-daily-tri/api/{daily-server,narrative-server}.ts` 까지는 구현됐으나 prompts/schemas/UI/위젯/페이지 통합이 누락된 상태.

본 spec은 (2)를 monthly와 동일 패턴으로 완성하고 (1)을 제거한다.

## 1. 결정 요약

| 항목 | 결정 | 근거 |
|---|---|---|
| 구현 패턴 | **monthly 1:1 미러링** (방안 A) | v0.3.x narrative 위젯은 실험 단계 — generic 추상화는 시기상조. 일관성 우선. |
| 탭 신설 | `daily` 탭 추가, `reading` 탭 안의 옛 `SajuDailyFortune` 섹션 제거 | UX 일관성 — 다른 시간 스코프와 동일하게 *탭 단위* 노출. |
| 탭 순서 | `lifetime → yearly → monthly → **daily** → chart → reading` | 대→소 시간 스케일 자연스러운 멘탈 모델. |
| Fetch 전략 | **Lazy fetch** (사용자가 탭 클릭 시 4학파 narrative 생성) | yearly/monthly와 동일. cron prefill 부하 없음. |
| Narrative 분량 | **800~1200자** (`narrativeText` zod: min 200 / max 1500, 프롬프트로 유도) | monthly와 동일 — 매일 읽기 부담 균형. |
| DB | **신규 `saju_daily_tri` + `saju_daily_narrative`** 테이블 생성, 옛 `saju_daily_fortunes` 는 Follow-up PR 에서 drop | 신규 시스템 안정 확인 후 옛 시스템 제거 — 두 단계 분리로 회귀 위험 최소화. |
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
├── features/saju-daily-tri/                # 신규 / 기존 절반 확장
│   ├── api/
│   │   ├── daily-server.ts                 # 신규 — getOrBuildDaily (현재 stub은 폐기·재작성)
│   │   ├── narrative-server.ts             # 신규 — getOrBuildDailyNarrative (현재 stub은 폐기·재작성)
│   │   ├── prompts.ts                      # 신규 — PROMPT_VERSION=1, SCHOOL_PROMPTS
│   │   ├── schemas.ts                      # 신규 — 4학파 zod 스키마
│   │   └── schemas.test.ts                 # 신규
│   ├── ui/
│   │   ├── DailyCrossCheckBadge.tsx        # 신규
│   │   ├── DailyFrameView.tsx              # 신규
│   │   └── TriDailyTabs.tsx                # 신규 (client)
│   ├── lib/errorMessage.ts                 # 기존 — daily 메시지 보강
│   └── index.ts                            # barrel
│
├── widgets/saju-tri-daily/                 # 신규
│   ├── ui/SajuTriDaily.tsx                 # RSC
│   └── index.ts
│
└── app/
    ├── api/saju/daily-narrative/route.ts   # 신규 — POST 핸들러
    └── fortune/[profileId]/page.tsx        # daily 탭 분기 + reading 탭 옛 일진 제거
```

> **확인 필요 — §0 "절반만 존재" 모듈 처리**: 기존 `features/saju-daily-tri/api/{daily-server,narrative-server}.ts` 의 *현재* 시그니처가 monthly 패턴(§2.3) 과 다를 가능성이 있다. 구현 1단계에서 두 파일 내용을 검토하여:
> - 시그니처가 §2.3 과 호환 → 그대로 확장 (prompts.ts, schemas.ts, ui/ 추가)
> - 호환 안 됨 → 폐기·재작성하고 monthly 패턴으로 통일
>
> 이 결정은 plan 작성 시점이 아니라 *구현 시작 시점*의 첫 작업이다. plan 의 첫 Task로 이 검토를 박는다.

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
  │     (profileId, school='compose', forDate, inputHash, schemaVersion, algorithmVersion)
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

### 3.1 신규 테이블 — `saju_daily_tri`

```sql
CREATE TABLE saju_daily_tri (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES fortune_profile(id) ON DELETE CASCADE,
  school            text NOT NULL,
  for_date          date NOT NULL,
  input_hash        text NOT NULL,
  schema_version    integer NOT NULL,
  algorithm_version integer NOT NULL,
  frame_jsonb       jsonb NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saju_daily_tri_school_check CHECK (school IN ('compose'))
);
CREATE UNIQUE INDEX saju_daily_tri_uniq ON saju_daily_tri
  (profile_id, school, for_date, input_hash, schema_version, algorithm_version);
CREATE INDEX saju_daily_tri_profile_date_idx ON saju_daily_tri
  (profile_id, for_date DESC);
```

### 3.2 신규 테이블 — `saju_daily_narrative`

```sql
CREATE TABLE saju_daily_narrative (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            uuid NOT NULL REFERENCES fortune_profile(id) ON DELETE CASCADE,
  school                text NOT NULL,
  for_date              date NOT NULL,
  frame_hash            text NOT NULL,
  model_id              text NOT NULL,
  prompt_version        integer NOT NULL,
  algorithm_version     integer NOT NULL,
  narrative_text        text NOT NULL,
  sections_jsonb        jsonb NOT NULL,
  school_specific_jsonb jsonb NOT NULL,
  citations             text[] NOT NULL,
  generated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saju_daily_narr_school_check
    CHECK (school IN ('ko','cn-ziping','cn-mangpai','jp'))
);
CREATE UNIQUE INDEX saju_daily_narr_uniq ON saju_daily_narrative
  (profile_id, school, for_date, frame_hash, model_id, prompt_version, algorithm_version);
CREATE INDEX saju_daily_narr_profile_date_idx ON saju_daily_narrative
  (profile_id, for_date DESC);
```

### 3.3 마이그레이션 분할

- **PR-A (이번 PR)**: `0019_saju_tri_daily.sql` — 두 테이블 생성. 옛 `saju_daily_fortunes` 는 건드리지 않음. (현재 최신 마이그레이션은 `0018_silent_compose_fix.sql`.)
- **PR-B (Follow-up, 며칠 후)**: `0020_drop_saju_daily_fortunes.sql` — `DROP TABLE saju_daily_fortunes`. 신규 시스템 운영 안정성 확인 후 진행.

> **참고**: `drizzle-kit generate` 가 자동으로 다음 번호를 부여하므로 *최종 파일명은 다를 수 있음*. spec은 *순서·내용 의도*만 명시. PR 시점에 `apps/dashboard/drizzle/` 최신 번호 확인하여 +1, +2 로 잡는다.

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

### 7.1 PR-A (이번 PR) — 사용 중지 + 표면 제거

- `widgets/saju-detail/index.ts`: `SajuDailyFortune` export 제거
- `widgets/saju-detail/ui/SajuDailyFortune.tsx`: 파일 제거 (다른 호출자 grep 후)
- `page.tsx`: `getTodayDailyFortune` import 제거, `dailyRow` fetch 제거, 옛 일진 섹션 JSX 제거
- `apps/dashboard/tests/saju-cron-daily.integration.test.ts`: 삭제

### 7.2 PR-B (Follow-up) — 깊은 정리

- `entities/saju-chart/api/*`: `getTodayDailyFortune` 함수 제거 (다른 호출자 없음 확인)
- `packages/saju/src/dailyFortune.ts`: 파일 제거
- `packages/saju/src/types/daily.ts`: `DailyFortunePayload` 등 제거
- `packages/saju` barrel: 위 타입 re-export 제거
- `apps/cron`: daily prefill 호출 job 제거 (있을 경우)
- `0014_drop_saju_daily_fortunes.sql`: 테이블 drop

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
pnpm db:generate              # 0013_saju_tri_daily.sql
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

- **PR-A revert**: 신규 테이블 2개 drop (`DROP TABLE saju_daily_narrative; DROP TABLE saju_daily_tri;`) + 코드 revert. 옛 시스템 그대로 살아있음.
- **PR-B revert**: 옛 테이블/코드 복원 시 신규 시스템과 공존 가능 (서로 독립).

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
