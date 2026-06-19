# 죽은 코드 정리 보고서 (2026-06-19)

`/ecc:refactor-clean` 실행 결과. **전체 모노레포 스캔 → SAFE 자동 정리 + report-only 분류.**

## 도구·검증선

- **스캔**: `knip` 6.17.1 (workspace + Next.js aware, zero-config), `depcheck` 1.4.7
- **검증선**: 순수 unit 627 passed + `pnpm typecheck` + `pnpm lint` + `pnpm build`
  (DB 통합 테스트 27개는 로컬 DB 미연결 ECONNREFUSED — baseline과 동일, 회귀 아님)
- **판정 방법**: knip 후보를 레포 전역 grep으로 재검증 (knip은 단일 워크스페이스 그래프만 봐서 cross-workspace import·동적 참조·barrel re-export·동명이인을 놓침)

## ✅ 자동 정리 완료 (commit `8559d78`)

**intra-module dead export 23개** (17파일, +18/-28). 모든 심볼은 in-file 사용 또는 완전 미사용으로 확인, barrel·cross-workspace·동적 참조와 무관.

### un-export (18개 — `export` 키워드만 제거, 선언·구현 보존)

| 심볼 | 파일 | in-file 사용처 |
|------|------|---------------|
| `IMPORTANT_CLASSIFIER_VERSION`, `LlmCategory`, `LlmImportance` | `shared/lib/llm/classify-important.ts` | `classifyImportantWithLlm`, `LlmImportantClassification` |
| `LlmSeverity`, `LlmClassifyOutput` | `shared/lib/llm/classify-thread.ts` | `LlmClassifyResult` 유니온 |
| `getTodaySajuSpendKrw` | `features/saju-reading/lib/budget.ts` | `assertSajuBudgetOk` |
| `SAJU_SYSTEM_PROMPT` | `features/saju-reading/lib/prompts.ts` | `buildReadingPrompt` |
| `Validator`, `ToRow` | `features/saju-reading/lib/cachedReading.ts` | `CachedReadingInput` |
| `CacheHit` | `shared/lib/saju/getOrBuildSajuTriCache.ts` | `SajuTriCacheConfig` |
| `InspectInput` | `entities/container/api/inspectContainer.ts` | `inspectContainer` 파라미터 |
| `ActionInput`, `ActionErrorCode` | `features/container-actions/api/_runAction.ts` | `ActionInputT`, `ActionResult` |
| `CronResultItem`, `CronEnvelope` | `shared/lib/cron/createCronHandler.ts` | 핸들러 내부 |
| `KrxMarket` | `features/krx-master-sync/api/fetch-krx-openapi.ts` | 파싱 루프 |
| `PortfolioHoldingKind` | `entities/portfolio-holding/model/types.ts` | `PortfolioHolding` |
| `TabsNavTab` | `shared/ui/Tabs/TabsNav.tsx` | `Props.tabs` |

### delete-whole (5개 — in-file 사용도 없는 순수 dead 선언)

| 심볼 | 파일 | 비고 |
|------|------|------|
| `__INTERNAL = { parseFromHeader }` | `features/gmail-sync/lib/full-rescan.ts` | 테스트용 wrapper인데 테스트가 안 씀. `parseFromHeader`는 in-file 사용으로 보존 |
| `Logger = typeof logger` | `shared/lib/log.ts` | 외부용 별칭, 소비처 0 |
| `KrxStockResponse` | `features/krx-master-sync/model/schema.ts` | z.infer 타입, 미사용 |
| `FortuneProfileInputT` | `features/fortune-profile-manage/api/_schema.ts` | z.infer 타입, 미사용 (sibling Zod schema는 보존) |
| `EmailSettingsInputT` | `features/email-settings-manage/api/_schema.ts` | 동일 |

## ⏸ Report-only (자동 정리 제외 — 사용자 판단 필요)

advisor 지침: barrel 공개 계약·cross-workspace API·동적 참조·config/진입점은 정적분석이 소비를 못 봐서 자동 삭제 위험. build가 green이어도 "아직 소비처 없는 의도적 public export"를 조용히 끊을 수 있음.

### A. NOT_DEAD — knip 오판 (조치 불필요)

grep 재검증에서 실제 참조 발견. **knip 목록을 그대로 삭제했으면 빌드가 깨졌을 항목들** — advisor 게이트가 막은 케이스.

- `NarrativeSchool` (refCount **15**), `FrameKey` — `shared/lib/saju/createNarrativeHandler.ts`, 4개 saju-tri가 re-export
- `Severity` (2) — `entities/email`, model/types.ts가 source-of-truth
- `currentKstAge`, `CitySelector`, `SajuChartWithReadings` — barrel re-export 실사용
- `ReplyFixtureSchema`, `ImportantFixtureSchema`, `ImportantFixture`, `Thresholds` — eval 하네스 사용
- `PlayMCP*` 6개 타입 — 외부 소비 result 타입의 필드 멤버
- `RELATION_ENUM` — 자기 파일 `z.enum()` 구조적 사용
- `Verdict` (`stock-push-flip/api/detect.ts`) — `stock-push-flip/index.ts:6`이 명시 re-export (name-grep은 동명이인 `stock-analysis`의 Verdict에 묻혀 0히트였음)

### B. CAUTION — barrel 공개 계약 (삭제하려면 barrel과 묶어서)

FSD `index.ts`/`server.ts`/`client.ts`가 명시 또는 `export *`로 노출. "외부 미사용"이 곧 dead 아님.

- **PROMPT_VERSIONS** ×4 (saju daily/lifetime/monthly/yearly) — `@krdn/saju` re-export, 4개 feature 동일 패턴
- **inspectContainer**(함수), **categoryStyle**+`CategoryStyle` — server.ts/client.ts barrel
- **PortMapping** ×2 (parseContainer.ts, container/model/types.ts) — docker/container barrel 다중 노출
- **PerspectiveResult, PersonaSlots, Persona, Timeframe, Evidence** — `stock-timeframe/client.ts:2` `export * from "./model/types"`
- **getSajuChartByProfile, getTodayDailyFortune, SajuYearlyReadingRow** — saju-chart barrel. ⚠️ **entangled**: `SajuChartWithReadings`가 "함수가 반환하니 NOT_DEAD"로 판정됨(순환). 함수·타입을 그룹으로 평가해야 반쪽 정리 방지
- **GENDER_VALUES/CALENDAR_VALUES**, **Playmcp*Row** 5종, **TigerProfileInputT** — tiger-reading `export *`
- **DebateEntry, DebateLog** — `autopilot-cycle/server.ts` re-export
- **AssetClass, Market, Quote, Fundamentals** — `entities/stock` quote-types.ts re-export 레이어
- **ImportantEmailsErrorState** — `widgets/important-emails` barrel (TODOS.md: ErrorBoundary 통합 예정)
- **ClassifiedBy, UserAction, OAuthState, ImportantClassification** — `entities/email` barrel
- **ToneDraft** — `email-reply` index.ts+client.ts 이중 노출, `generateReplyDraft` 반환 타입
- **DigestItem** — `entities/digest` barrel
- **__INTERNAL** (`deterministic-classifier.ts`) — 테스트용인데 테스트 미사용. future-facing 의도 가능, 보류
- **Env** (`shared/config/env.ts`) — 미사용 타입이나 env config 파일이라 신중

### C. Unused files — 대부분 진입점/barrel FP

| 파일 | 판정 |
|------|------|
| `public/sw.js` | **보존** — service worker, 런타임 `register('/sw.js')` |
| `entities/stock/server.ts` (307 refs) | **보존** — knip file-level FP, 실제 대량 사용 |
| `features/{auth,email-reply,saju-yearly-tri}/index.ts` (각 62 refs) | **보존** — FSD barrel |
| `scripts/fix-oauth-scope.ts`, `_dryrun-oauth-scope.ts` | **보존** — 수동 실행 진입점 (CLAUDE.md Gotcha #6) |
| `scripts/verify-final.mjs` | **보존** — tickerlens 회귀 방지 스모크 스크립트 |
| `entities/stock-master/model/types.ts`, `shared/config/tokens.ts` | **보존** — barrel/대량 참조 |
| `features/stock-timeframe-analyze/ui/TickerInput.tsx` | ⚠️ **진짜 dead 후보** — 전역 import 0 |

### D. Unused dependencies — report-only

| 의존성 | 판정 |
|--------|------|
| `@tanstack/react-query`, `zustand` | **보존 권장** — CLAUDE.md "도입 완료"이나 사용처 미생성. 제거 시 향후 재설치 |
| `@gons/shared-mcp-runtime` | **보존** — workspace 의존, 실제 2곳 사용 (knip FP) |
| `prettier-plugin-tailwindcss` (devDep) | 후보 — prettier 설정 확인 필요 |
| `lsof` (unlisted binary) | container action에서 사용, package.json 미선언 — 문서화 후보 |

### E. 미검증 — packages 공개 API (cross-workspace)

워크플로의 stock 청크가 timeout으로 부분 실패. 아래는 패키지 public API라 dashboard/MCP stdio가 cross-workspace 소비 가능 — **자동 삭제 금지, 별도 검증 필요**:

- `packages/stock-analysis`: `DART_STATUS`, `DartAccountItemSchema`, `KRX_SYMBOLS`, `DartResponse`, `KrxEntry`
- `apps/cron`: `scheduler.js`/`autopilot/deploy-watcher.js` (cron 컨테이너 진입점 — knip FP), `node-cron`(런타임 사용)

## 2차 검증 — 잔여 후보 다각도 확정 (commit `5d811c8`)

C/E 잔여 후보를 investigate→adversarial 워크플로로 재검증(8 에이전트). 5분류 판정:

### 추가 자동 정리 완료

| 후보 | 판정 | 조치 |
|------|------|------|
| `TickerInput.tsx` | DEAD_REMOVABLE (반박 실패) | **파일 삭제** — `TickerSearchInput`으로 대체된 superseded 컴포넌트, barrel 없음, 전역 import 0 |
| `DART_STATUS` (`stock-analysis/dart-types.ts`) | 진짜 dead | **완전 제거** — 코드가 상수 대신 리터럴 하드코딩 |
| `DartResponse` (type) | 진짜 dead | **라인 제거** — `DartResponseSchema`만 사용, type alias 미사용 |
| `DartAccountItemSchema`, `KRX_SYMBOLS`, `KrxEntry` | in-file 사용 | **un-export** — 패키지 public barrel(index/client) 미노출, 내부 전용 |

### 보존 확정 (자동 정리 제외)

| 후보 | 판정 | 근거 |
|------|------|------|
| `apps/cron` `scheduler.js`, `deploy-watcher.js`, `node-cron` | KEEP_ENTRYPOINT | Dockerfile CMD 진입점 + 런타임 `cron.schedule()` 7회. knip이 Docker 진입점 분석 못 함 |
| `@tailwindcss/postcss`, `tailwindcss` | KEEP_FALSE_POSITIVE | postcss.config.mjs + globals.css `@import` 빌드 파이프라인. depcheck가 CSS directive 못 봄 |
| `scripts/_dryrun-oauth-scope.ts`, `verify-final.mjs` | KEEP_ENTRYPOINT | 수동 실행 CLI (RUNBOOK.md 문서화 + 헤더에 실행법). package.json scripts에 없는 게 정상 |
| `@tanstack/react-query`, `zustand` | **보존 (적대적 검증이 삭제 반박)** | 코드 0 usage지만 server-infra 설계 스펙(2026-05-10)·TODOS.md v0.2·CLAUDE.md "도입 완료"가 의도적 staging 입증. NEEDS_USER_DECISION → 반박 단계서 "보존이 정답"으로 좁혀짐 |

## 권고

1. **자동 정리분(`8559d78` + `5d811c8`)은 검증 완료** — 머지 가능.
2. **B(barrel/entangled)·cron·tailwind·oauth·react-query/zustand는 보존 확정** — 추가 정리 여지 없음.
3. B의 FSD barrel 공개 계약을 의도적으로 좁히려면 slice 단위 별도 검토 (현재 비권장).
