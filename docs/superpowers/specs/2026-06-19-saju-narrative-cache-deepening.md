# 삼국 narrative 캐시 deepening — Design Spec

- **Date**: 2026-06-19
- **Scope**: 4개 tri narrative-server(`features/saju-{lifetime,yearly,monthly,daily}-tri/api/narrative-server.ts`)가 공유하는 동일 골격 (frameHash → cache 조회 → null 자가치유 → budget guard → LLM+ZodError 재시도 → spend log → UPSERT → envelope) 을 단일 `createNarrativeCache` 팩토리로 묶는다.
- **Non-goals**: prompt 텍스트(분량 문구·스키마 예시·schoolSpecific 예시) 통합 안 함 — `buildUserContent` 콜백 뒤에 유지. errorMessage 매퍼 통합(감사 후보 3)은 "의도적 복제" 결정 충돌이라 별개. Tabs 상태머신 headless 훅(후보 2)은 별개 PR.
- **Status**: design grilling 완료 (2026-06-19 `/improve-codebase-architecture` 세션, deepening 후보 1).
- **Prerequisite**: 없음 — `createSajuTriCache`(frame), `createNarrativeHandler`(route)가 이미 main 에 정착. 이 둘 사이 빈 칸을 채운다.

## 1. 배경 — deepening 후보 1 (감사 결과)

`features/saju-{lifetime,yearly,monthly,daily}-tri/api/narrative-server.ts` 4개 파일(218~242 LOC)이 동일한
LLM cache-or-generate 골격을 함수명·로그프리픽스만 바꿔 베껴 쓴다. retry wrapper(`callXxxLlmAndParseWithRetry`)만
48줄×4=192줄 byte-identical(검증 에이전트가 `diff -u`로 확인).

### 1.1 공통 골격 (factory 가 묻을 것)

```
1. frameHash = computeFrameHash(frame)
2. cache findFirst (where: profileId, school, ...추가키, frameHash, modelId, promptVersion, algorithmVersion)
3. null 자가치유 가드 — sections·schoolSpecific 둘 다 null 체크 시 regen fall-through
4. assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW)  (cache miss 확정 후, build 당 1회)
5. retry 루프 (attempt 1~2): analyzeStructured + normalizeUsage + computeKrw
     - ZodError → 1회 재시도 (attempt 2: userContent 끝에 실패 필드 reminder 첨부)
     - JSON.parse/LLM 실패 → 즉시 throw (재시도 무의미)
6. logSajuSpend (validate 성공 후에만 — "validated outputs only")
7. onConflictDoUpdate UPSERT (동시 cache miss / null 자가치유 idempotent)
8. result envelope 조립 + return
```

### 1.2 변이점 (caller 가 config 로 제공) — 코드에서 전수 추출

| 변이점 | lifetime | yearly | monthly | daily |
|---|---|---|---|---|
| cache 테이블 | `sajuLifetimeNarrative` | `sajuYearlyNarrative` | `sajuMonthlyNarrative` | `sajuDailyNarrative` |
| 추가 키 컬럼 | — | `year` | `targetYear, targetMonth` | `forDate` |
| `MAX_NARRATIVE_TOKENS` | 8192 | 6144 | 4096 | 4096 |
| logTag | `saju-lifetime-narrative` | `saju-yearly-narrative` | `saju-monthly-narrative` | `saju-daily-narrative` |
| result 추가 필드 | — | `targetYear` | `targetYear, targetMonth` | `forDate` |
| frame 타입 | `LifetimeFrame` | (yearly frame) | (monthly frame) | `DailyLiteFrame` |
| sections 타입 | `LifetimeNarrativeSections` | (yearly) | `MonthlyNarrativeSections` | `MonthlyNarrativeSections`(재사용) |
| buildUserContent | 분량/스키마/example 상이 | 상이 | 상이(+example 맵) | 상이(+example 맵) |

**현재 정당화되지 않은 불일치(통일 대상)**: null 가드가 daily만 `sections`+`schoolSpecific` 둘 다, 나머지 3개는
`schoolSpecific`만 → **둘 다 검사로 통일**(lifetime/yearly/monthly는 sections가 실제론 항상 채워지므로 더 엄격한
가드가 무해, 자가치유 조건만 넓어짐).

### 1.3 Deletion test (검증 통과)

4개 narrative-server를 삭제하면 복잡도가 사라지는 게 아니라 **4개 route 핸들러**
(`app/api/saju/{lifetime,yearly,monthly,daily}/[profileId]/narrative/route.ts`)에 retry+budget+cache+upsert가
인라인으로 재출현. 각 narrative-server는 deep하지만 **4벌 병행 복제**된 상태 — 이게 결함.

### 1.4 선례 (이 factory가 발명이 아닌 이유)

같은 4중 평행이 **위아래 두 레이어에서 이미 factory로 해소**됨:
- `createSajuTriCache<T,P>` (`shared/lib/saju/getOrBuildSajuTriCache.ts`) — **frame 캐시** 레이어
- `createNarrativeHandler<P>` (`shared/lib/saju/createNarrativeHandler.ts`) — **route** 레이어 (variation point 3개 주석)

그 사이 **narrative 레이어**만 factory가 없어 4벌 복붙. 이 spec은 thick-adapter/thin-factory 샌드위치의 빈 칸을 채운다.
인터페이스는 `createSajuTriCache`를 **정확히 미러** — DB I/O를 `findCached`/`insertCache` 콜백으로 위임하고 factory는
hash + orchestration + (여기선 추가로) LLM 정책 시퀀스만 소유. ⚠️ 단순 "동형"이 아님에 주의: `createSajuTriCache`는
*결정적 build* (LLM 없음)이고, 이 factory는 *LLM build + retry + budget + spend* 를 추가로 묻는다 — narrative 레이어가
한 층 위라 정책이 더 두껍다.

## 2. 인터페이스 (grilling 확정)

**위치**: `shared/lib/saju/createNarrativeCache.ts` (선례와 나란히)

**제네릭**: `createNarrativeCache<Frame, Extra, Sections, Result>` — `createSajuTriCache<T,P>`의 콜백 위임 패턴 미러.

> **설계 진화 (구현 중 두 차례 정정 — advisor 차단 후 확정)**:
> 1. 초안의 `table` + `extraKeyCols: (extra)=>SQL[]` 는 monthly의 `extra={targetYear,targetMonth}`가 **네 곳**(WHERE /
>    INSERT `.values()` / `onConflictDoUpdate` target / result envelope)에 흘러야 하는데 WHERE만 먹여 기각. cache I/O를
>    `findCached`/`insertCache`/`toResult` 콜백으로 통째 위임 (`createSajuTriCache` 패턴).
> 2. budget(`assertSajuBudgetOk`/`logSajuSpend`)을 factory가 직접 import하려 했으나 **FSD 위반** — factory는 `shared`,
>    budget은 `features/saju-reading`이라 `shared → features` 역의존. ESLint `boundaries/element-types`가 차단. 해소:
>    budget도 `assertBudget`/`logSpend` 콜백으로 caller(features)가 주입. factory는 "언제 호출"만 소유 (`createSajuTriCache`가
>    `BuildError`를 config로 주입받는 것과 동형).
> 3. `buildUserContent`는 `(frame, school)`이 아니라 `ctx` 전체를 받는다 — 원본 prompt의 `${targetYear}년 세운 분석` 같은
>    extra 참조를 재현하려면 `ctx.extra`가 필요. (yearly에서 한 번 targetYear를 빠뜨렸다 잡음.)

```ts
interface NarrativeCacheConfig<Frame, Extra, Sections, Result> {
  logTag: string;                                 // "saju-lifetime-narrative" — 운영 로그 grep 패턴 보존
  schema: Record<NarrativeSchool, ZodType<NarrativeOutputShape<Sections>, ZodTypeDef, unknown>>;
  maxTokens: number;                              // 8192 / 6144 / 4096 / 4096
  // budget/spend 주입 (FSD: factory=shared 는 features 의 budget 직접 import 불가)
  assertBudget: () => Promise<void>;
  logSpend: (input: { model; inputTokens; outputTokens; krw }) => Promise<void>;
  // prompt — ctx 전체를 받아 frame·school·extra(targetYear/forDate...) 모두 접근
  buildSystemPrompt: (school: NarrativeSchool) => string;
  buildUserContent: (ctx: NarrativeCallContext<Frame, Extra>) => string;
  // cache I/O 위임 — 모든 콜백이 매 호출 ctx 를 받아 ctx.extra 에서 추가 키를 꺼냄
  findCached: (ctx: NarrativeCallContext<Frame, Extra>) => Promise<CachedNarrativeRow<Sections> | undefined>;
  insertCache: (row: NarrativeRowToWrite<Frame, Extra, Sections>) => Promise<void>;  // INSERT + conflict target 전부 caller
  toResult: (payload: NarrativeOutputShape<Sections>, meta: { ctx; modelId; ...; fromCache }) => Result;  // envelope 조립
}
// 반환 함수: (ctx: NarrativeCallContext<Frame, Extra>) => Promise<Result>
// ctx = { profileId, school, frame, frameHash, modelId, promptVersion, algorithmVersion, extra }
```

**factory가 소유 (정책 시퀀스, narrative-server 4벌 약 730줄 → 1벌)**: frameHash 기반 cache 조회 + null 자가치유
가드(sections·schoolSpecific 둘 다) + budget 호출 순서(budget→LLM→spend) + retry 루프(ZodError 1회) +
`analyzeStructured`/`normalizeUsage`/`computeKrw`.

**caller(4개 narrative-server)가 남기는 것**: config 한 객체 + 얇은 export wrapper(원본 시그니처 보존 — route 무수정).
cache 쿼리·budget 모듈·envelope 조립·prompt는 콜백 안.

### 2.1 grilling + 구현 결정 요약

1. **Seam 깊이 = 정책 시퀀스를 묻기** — factory는 retry/budget순서/spend/null가드/orchestration 소유. DB I/O·budget
   모듈·prompt는 콜백 위임. "table을 declarative하게 받기"는 DB-shape 변이가 4곳에 흘러 컴포즈 불가라 기각.
2. **로그 태그 = logTag config 주입** — 운영 로그 grep 패턴(`[saju-*-narrative]`) 무회귀.
3. **null 가드 = 둘 다 검사로 통일** — 변이점 제거, 4개 동일 (유일한 의도적 동작 변경).
4. **userContent = buildUserContent(ctx) 콜백** — prompt 텍스트(가장 자주 바뀜)는 caller에, factory는 prompt 포맷 미소유.
5. **factory 위치 = shared/lib/saju/** — frame/narrative/route factory 삼총사 한 디렉토리.
6. **cache I/O = findCached/insertCache/toResult 콜백** + **budget = assertBudget/logSpend 콜백** — DB-shape 변이와
   FSD 역의존을 모두 caller 주입으로 흡수. factory는 `table`도 budget 모듈도 직접 안 받음.

## 3. 검증 (테스트가 어떻게 개선되나)

- **현재**: retry/budget/upsert 정책을 검증하려면 4개 narrative-server를 각각 테스트(또는 안 함). LLM mock이 4벌.
- **이후**: factory 인터페이스에서 retry(ZodError 1회) + budget guard + "validated outputs only" spend + null 자가치유를
  **한 번** 검증. 4개 adapter는 config(테이블·키·prompt)만 다르므로 얇은 smoke 테스트로 충분.
- **Locality**: retry 정책 변경(예: 2회 재시도) 또는 budget 정책 변경이 4곳 → 1곳.
- **Leverage**: 새 timeframe(예: weekly) 추가 시 config 한 객체만.

## 4. 마이그레이션 / 위험

- **DB 무변경** — 기존 4개 cache 테이블 그대로. factory는 **거의** 동작 보존 리팩터.
- ⚠️ **단 하나의 의도적 동작 변경**: null 자가치유 가드를 4개 모두 `sections`+`schoolSpecific` 둘 다 검사로 통일
  (현재 lifetime/yearly/monthly는 `schoolSpecific`만). 이론상 도달 불가 + self-healing 경로라 정상 응답엔 무영향이나,
  §5의 "라우트 응답 동일성 확인"은 **정상 cache hit/miss 경로만** 비교 — null row 자가치유 경로는 별도 단위 테스트로
  커버(이 변경이 정상 응답을 바꾸지 않음을 단언).
- **검증 게이트**: `cd apps/dashboard && pnpm build` 필수 (features→features import + server-only seam — Gotcha #7).
- **운영 로그**: logTag 주입으로 `[saju-*-narrative]` grep 패턴 보존 — 모니터링 무회귀.
- **PROMPT_VERSION**: buildUserContent가 caller에 남으므로 prompt 버전 무영향. cache 키 무변경.

## 5. 다음 단계

TDD: factory 인터페이스 테스트(retry/budget/null가드/spend) 먼저 → factory 구현 → 4개 narrative-server를
config로 치환 → build 검증 → 운영 narrative 라우트 4종 응답 동일성 확인.
