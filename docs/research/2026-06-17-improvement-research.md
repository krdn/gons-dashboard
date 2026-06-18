# gons-dashboard 개선점 정밀 리서치 (2026-06-17)

> 멀티 에이전트 워크플로우(8개 영역 병렬 탐색 → 영역별 적대적 재검증 → 종합)로 수집.
> graphify 그래프(commit `dcac8879`, 4373 노드) 기반. 검증 통과 발견 **59개**.
> 검증 단계에서 "의도된 설계"(라이트모드 고정, Haiku 분류 고정, monorepo 유지, `TEST_DATABASE_URL` 가드, eval thresholds placeholder)는 이미 제외됨.

---

## 0. TL;DR — 가장 먼저 손대면 ROI 높은 Top 5

severity(high) × ease(trivial/small) × confidence 종합 순.

| # | 항목 | 영역 | 작업규모 | 확신 | 한 줄 |
|---|------|------|----------|------|-------|
| 1 | **push DELETE에 userId 소유권 체크 누락** | security | trivial | 0.75 | `DELETE /api/push/subscribe`가 endpoint만으로 삭제 — 남의 구독도 지울 수 있음 (IDOR) |
| 2 | **`MarketSnapshot` 타입이 스키마와 어긋남** | stock | small | 0.98 | entity의 수기 interface가 패키지 스키마의 PR2 필드(EPS/BPS/매출성장 등) 누락 — re-export로 교체 |
| 3 | **cron `callCron` fetch 타임아웃 미설정** | db/cron | small | 0.95 | LLM 작업 hang 시 cron promise 영구 pending → 다음 주기 누락/메모리 누적 |
| 4 | **`fullRescan` Date 헤더 파싱 무방비** | email | small | 0.82 | `internalDate`/`Date` 둘 다 실패 시 `new Date()`(현재)로 폴백 → 메일 수신시각 소실, 정렬 깨짐 |
| 5 | **`getValidAccessToken` 네트워크 에러 미처리** | shared/auth | small | 0.80 | 토큰 endpoint fetch/json 파싱 실패 시 unexpected throw가 caller(syncInbox 등)로 전파 |

이 5개는 전부 **high severity + small/trivial effort**라 한 PR로 묶어 처리 가능. 아래 §6 참고.

---

## 1. 도메인별 건강 요약

| 도메인 | 발견 | 한 줄 진단 |
|--------|------|-----------|
| **Email** | 13 | 기능은 견고하나 **에러 관찰성(observability)이 약함** — Gmail/LLM 실패가 조용히 삼켜지고 구조화 로깅 누락이 반복됨. 답장/분류 happy-path는 탄탄. |
| **Stock** | 8 | Phase 진행 중 흔적 — **타입 드리프트 1건(높은 확신)**, flip/push 테스트 공백, DART/race 엣지 처리 미흡. 코어 로직은 동작. |
| **Saju** | 3 | 핵심 결함은 **LLM 예산 가드가 narrative 경로에 누락**(일진만 차감, 학파별 16+ 호출이 예산 밖) — 비용 폭주 가능. 나머지는 스키마 정합/주석 정리. |
| **Infra Monitor** | 8 | 기능 안전(감사로그·타임아웃 존재). 대부분 **테스트 공백 + console.error→structured logger 일관성** 이슈. 위험도 낮음. |
| **shared/LLM/Auth** | 10 | **횡단 테마 2개가 지배적**: ① LLM 에러 처리 방식이 모듈마다 다름(throw vs `{kind:'llm-unavailable'}`), ② `console.*`가 운영에서 수집 안 됨. 인증 회복 설계는 양호. |
| **DB/Cron/Deploy** | 7 | cron 타임아웃이 진짜 버그. 나머지는 Dockerfile 수동 COPY·마이그레이션 검증 자동화 등 **운영 안전망 보강**. |
| **FSD/Arch** | 3 | 경계 위반 없음(lint 강제 효과). saju 4개 narrative-server **869줄 중복**(의도된 복제지만 추출 여지), email entity barrel `server-only` 가드 누락. |
| **Security** | 7 | critical 없음. **정보 노출(raw 에러 메시지)·Cache-Control 누락·IDOR 1건**이 핵심. timing-safe 비교 등은 hygiene. |

---

## 2. 🔧 수정이 필요한 것 (bug / tech-debt / consistency / perf / security / architecture)

### P0 — 즉시 (high severity, 작업 작음, 확신 높음)

| 항목 | 위치 | 제안 | 규모 |
|------|------|------|------|
| **push 구독 DELETE IDOR** | `app/api/push/subscribe/route.ts:46-62` | `.where()`에 `eq(userId, session.user.id)` 추가 — 현재 endpoint만으로 삭제되어 타 사용자 구독 제거 가능 | trivial |
| **`MarketSnapshot` 타입 드리프트** | `entities/stock-analysis/model/consensus-types.ts:15-28` | 수기 interface를 `export type { MarketSnapshot } from '@gons/stock-analysis/client'`로 교체. 패키지 스키마(`packages/stock-analysis/src/schemas/consensus.ts:18-44`)가 source of truth | small |
| **cron fetch 타임아웃 없음** | `apps/cron/scheduler.js:29-32` | `callCron`에 `AbortSignal.timeout()` 추가(라우트별 30~120s) + `unhandledRejection` 핸들러. hang → 다음 주기 누락 방지 | small |
| **`fullRescan` Date 파싱 무방비** | `features/gmail-sync/lib/full-rescan.ts:59-66` | `Date` 헤더 `isNaN(parsed.getTime())` 검증 후 invalid면 `null` 저장(현재시각 폴백 금지) + warn 로그 | small |
| **`getValidAccessToken` 네트워크 에러** | `shared/api/gmail/auth.ts:74-86` | `fetch`/`response.json()`를 try-catch로 감싸 `GmailServerError(503)`/`GmailClientError(502)`로 분류. 현재는 unexpected throw가 caller로 전파 | small |
| **`updateHolding` kind 변경 시 CHECK 위반** | `features/stock-portfolio-crud/api/updateHolding.ts:15-30` | `kind='watchlist'`로 바꿀 때 `quantity`/`avgCost` null 강제하는 Zod `.refine()` 추가. 현재 DB CHECK 위반으로 raw 에러 노출 | small |

### P1 — 곧 (high/medium severity)

| 항목 | 위치 | 제안 | 규모 | 확신 |
|------|------|------|------|------|
| **`sendReply`/draft 에러 구분·로깅 없음** | `features/email-reply/api/sendReply.ts:47-63` | `classifyGmailError` 호출 + `logger.error` + `SendReplyResult` 유니온 세분화(rate-limited/server-error/reauth-required). 현재 전부 `send-failed` | medium | 0.90 |
| **`classifyThreadsLoop` important 실패 은폐** | `features/gmail-sync/lib/classifyThreadsLoop.ts:130-137` | `importantErrors` 카운터 분리(`throw`를 정상 outcome과 섞지 말 것) + syncInbox에서 warn 레벨 집계 로그 | small | 0.95 |
| **`generateReplyDraft` thread fetch 실패 은폐** | `features/email-reply/api/generateReplyDraft.ts:85-93` | `thread-fetch-failed` outcome 추가 + `logger` 호출 + UI 경고 배너(스니펫 기반 저품질 초안임을 표시) | small | 0.92 |
| **info 노출 — raw 에러 메시지 응답** | `app/api/stock/{search,quote}/route.ts`, `health/route.ts` | 운영에서 `detail: msg` 제거, 서버측 structured log + 클라이언트엔 generic 메시지(502/503) | small | 0.90 |
| **Saju narrative 4종 중복 869줄** | `features/saju-{daily,monthly,yearly,lifetime}-tri/api/narrative-server.ts` | `shared/lib/saju/buildNarrative.ts`로 LLM retry·캐시키·검증·저장 공통화(주입식). FSD 위반 없이 추출 가능 | medium | 0.80 |
| **Dockerfile workspace 수동 COPY** | `apps/dashboard/Dockerfile:13-17,31-34` | CI에 `packages/*/package.json`이 두 stage 모두에 참조됐는지 검증하는 셸 스크립트(메모리 `workspace-package-dockerfile-gotcha` 재발 방지) | medium | 0.80 |
| **stock 검색어 상한 없음** | `app/api/stock/search/route.ts:14-16` | Zod `z.string().min(1).max(256)` — 초장문 쿼리가 trigram 인덱스에 과부하 | trivial | 0.70 |
| **Cache-Control 누락(개인화 응답)** | `app/api/saju/*/route.ts` 외 | saju/stock/push 라우트에 `Cache-Control: private, no-store`. MCP credentials는 이미 적용됨 | small | 0.70 |

### P2 — 여유될 때 (medium, 또는 확신 보통)

| 항목 | 위치 | 규모 | 확신 |
|------|------|------|------|
| `triggerAnalysis` inserted 판정이 5초 휴리스틱 → 고지연 race | `features/stock-analysis-server/api/trigger.ts:96-103` (`startRun`이 `isInserted` 반환하도록) | medium | 0.85 |
| Saju null `schoolSpecificJsonb` 자가치유 + 낡은 주석(PROMPT_VERSION=2→3/4) | `saju-{yearly,lifetime}-tri/api/narrative-server.ts` | small | 0.78 |
| `resolveClaudeModel`/`rateLimit`/`_runAction` 등 **`console.*`→`logger`** 일관화 | `shared/lib/llm/resolve-claude-model.ts`, `rateLimit.ts`, `features/container-actions/api/_runAction.ts:109` | small×3 | 0.65~0.85 |
| LLM 에러 처리 패턴 불일치(throw vs `{kind:'llm-unavailable'}`) | `shared/lib/llm/{classify-important,draft-reply}.ts` | small | 0.75 |
| DART API auth 에러를 transient처럼 `.catch(()=>null)` | `features/stock-analysis-server/api/orchestrator.ts:98-102` | small | 0.75 |
| `MCP_DASHBOARD_TOKEN` 정적 bearer 로테이션 정책 부재(v2 HMAC 예정) | `env.ts:119` + `app/api/mcp/credentials/google/route.ts` | small | 0.70 |
| createDraft/sendDraft 429 백오프 없음 | `shared/api/gmail/drafts.ts:92-104` | medium | 0.75 |
| env Zod 실패 시 누락 변수명 노출 | `shared/config/env.ts` parse 지점 | trivial | 0.50 *(확신 낮음 — 운영 로그 접근성 확인 필요)* |
| playmcp pgcrypto 키 로테이션(dual-key) 부재 | `shared/lib/db/schema/playmcp.ts` | medium | 0.65 |

### P3 — 백로그 (low severity, 또는 확신 낮음 — 직접 확인 권장)

- `classifyImportantThread` 스니펫 `slice(0,200)`이 UTF-8 비안전(이모지/CJK 글자 분할) — `truncateBytes` 재사용. `email`, trivial, 0.85
- `dismissThread` 0행 영향 무검증(스팸 클릭) — `.returning()` 체크. `email`, trivial, 0.75
- `generateReplyDraft` 부분 실패(3톤 중 1톤만 성공해도 ok) — `partial-ok` 또는 메타 노출. `email`, small, 0.50~0.80
- email entity barrel에 `import 'server-only'` 가드 누락(일관성) — `entities/email/index.ts`. trivial, 0.60
- email-settings `isSyncDue`/`isDigestDue`를 client.ts에도 노출(일관성). trivial, 0.70
- Docker 라벨/포트 파싱 한계(쉼표·IPv6·포트레인지 silent drop) — **이미 코드 주석에 문서화됨**, 현 설정선 안전. consistency, 0.30~0.40 *(확신 낮음)*
- `pgcrypto` 키 유도 주석 명확화(hex→utf8→sha256) — 버그 아님, 문서. 0.75
- OAuth scope 축소 케이스 미대응(subset 재로그인 시 옛 scope 잔존) — 테스트+주석. 0.65
- timing-unsafe bearer 비교(`google/route.ts:29`) — `timingSafeEqual`. trivial, 0.95 *(영향 작음, hygiene)*
- ADMIN_EMAILS 파싱 두 라우트 불일치(trim/filter) → `shared/lib/auth/parse-admin-emails.ts` 추출. trivial, 0.75
- health 엔드포인트 DB 에러 응답 노출 — 운영에서 generic. trivial, 0.80

---

## 3. ➕ 추가가 필요한 것 (missing-feature / test-gap)

### 테스트 공백 (회귀 방어 가치 높음)

| 항목 | 위치 | 규모 | 확신 |
|------|------|------|------|
| **flip 감지 + push 알림 무테스트** | `features/stock-push-flip/` (테스트 0개) | `detectConsensusFlip`/`notifyFlip` — 24h dedup UNIQUE 위반 캐치, expired 구독, no-subscriptions 경로 | medium | 0.90 |
| **invalid_grant / oauth_state 전이 무테스트** | `shared/api/gmail/auth.ts:88-99` | `reauth_required` 쓰기 검증(현재 mock이 실제 DB 경로 안 탐). 실 DB 픽스처 4종 | small | 0.80 |
| Docker context 불일치 에러 경로 무테스트 | `entities/host/api/getHosts.ts` + container-actions | medium | 0.65 |
| `runDocker` execFile 타임아웃 동작 무테스트(ETIMEDOUT/SIGTERM) | `shared/lib/docker/runDocker.ts:14-28` | small | 0.65 |
| ADMIN_EMAILS 대소문자 무관 매칭 명시 테스트(코드는 정상) | `features/container-actions/lib/isAdmin.ts` | small | 0.60 |
| eval에 empty-signals important 픽스처 추가(first-sync 경로) | `tests/eval/fixtures/important.json` | trivial | 0.65 |
| `syncMissingProjects` empty observed + hidden 엣지 테스트 | `entities/project/api/syncMissingProjects.ts` | small | 0.70 |

### 미구현 기능

| 항목 | 위치 | 제안 | 규모 | 확신 |
|------|------|------|------|------|
| **Saju LLM 예산 가드가 narrative 경로에 없음** ⚠️ | `features/saju-*-tri/api/narrative-server.ts` | `assertSajuBudgetOk` + `logSajuSpend`를 4개 narrative 경로에 추가. 현재 일진만 차감 → 학파별 16+ 호출이 예산 밖(비용 폭주 가능) | medium | 0.92 |
| `unmarkReplied` UI 미배선(5초 undo) | `features/email-analysis/api/markAsReplied.ts:40-59` | ReplyCard 토스트 undo 또는 주석을 "v0.2 deferred"로 정정 | small | 0.85 |
| 마이그레이션 dry-run/drift CI 검증 | `package.json` `db:migrate` + workflows | `db:generate` 후 미커밋 diff면 CI fail | medium | 0.60 *(확신 보통)* |
| cron 컨테이너 watchdog(헬스체크 대신 마지막 성공 타임스탬프 기반 exit) | `docker-compose.yml` cron + `scheduler.js` | small | 0.70 |
| persona override Zod 검증(DB JSONB 손상 방어) | `entities/stock-analysis/api/persona-router.ts:49-62` | trivial | 0.65 |
| partial index 생성 검증 CI | `db:migrate` 후 `pg_indexes` 조회 | small | 0.50 *(확신 낮음)* |

---

## 4. 횡단 테마 (여러 영역에서 반복 — 한 번에 처리 권장)

1. **구조화 로깅 일관화** — `console.warn/error`가 운영에서 수집 안 됨. `resolve-claude-model.ts`, `rateLimit.ts`, `_runAction.ts:109`, `generateReplyDraft`, `sendReply` 등 다수가 `logger.{warn,error}(scope, event, meta)` 패턴으로 통일 필요. (D6 패턴이 일부만 적용됨) → **한 PR로 sweep 가능.**
2. **LLM 호출 견고성** — 재시도/타임아웃/에러분류가 모듈마다 제각각. stock의 `callLlmAndParseWithRetry`(`features/stock-analysis-server/api/llm-call.ts`)를 `shared/lib/llm`으로 추출해 email/saju에도 적용.
3. **에러 응답 위생** — stock/health/saju 라우트의 raw 에러 노출 + Cache-Control 누락을 함께 정리.

---

## 5. 검증 메모 (신뢰도 관련)

- **확신 낮음(<0.6)으로 직접 재확인 권장**: env Zod 노출(0.50), partial index CI(0.50), generateReplyDraft 부분실패(0.50), Docker 라벨/포트 한계(0.30~0.40), AuditLog N+1(0.50). 이들은 "지금 당장 문제"라기보다 "미래 변경 시 취약" 성격이 많음.
- **확신 높음(≥0.9)**: MarketSnapshot 타입(0.98), classifyThreadsLoop 은폐(0.95), cron 타임아웃(0.95), timing-unsafe 비교(0.95), generateReplyDraft 은폐(0.92), Saju 예산(0.92), flip 테스트(0.90), sendReply 로깅(0.90), info 노출(0.90).
- monorepo 분리/라이트모드/Haiku 고정 등은 검증에서 "의도된 설계"로 걸러져 본 리포트에 없음.

---

## 6. 권장 실행 순서

1. **PR A "안전망 5종"(P0)** — push IDOR + MarketSnapshot 타입 + cron 타임아웃 + fullRescan Date + getValidAccessToken + updateHolding refine. 전부 small 이하, 운영 위험 직결.
2. **PR B "관찰성 sweep"(횡단①+P1 로깅)** — `console.*`→`logger` 통일 + sendReply/generateReplyDraft/classifyThreadsLoop 에러 구분.
3. **PR C "Saju 예산 가드"** — narrative 4경로 budget 적용(비용 폭주 차단). 단독 PR 권장(영향 명확·테스트 필요).
4. **PR D "테스트 공백"** — flip/push + invalid_grant oauth_state.
5. 이후 P2/P3는 관련 영역 작업할 때 묶어서.
