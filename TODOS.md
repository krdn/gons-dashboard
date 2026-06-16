# TODOS

`/plan-eng-review` 또는 `/office-hours`에서 도출된 후속 작업 목록. v0.1 범위 외이지만 의도적으로 유지하는 항목들.

생성/마지막 갱신: 2026-05-09

## v0.2 후보

### 1. HMAC short-lived token으로 cron 인증 업그레이드

- **What**: cron Bearer를 장기 secret에서 HMAC 기반 60초 TTL 토큰으로 전환
- **Why**: secret이 노출되어도 자동 회전, 외부 webhook(Slack/Discord 알림 등) 도입 시 동일 구조 재활용
- **Pros**: 장기 secret 관리 스트레스 제거, 외부 통합 대비
- **Cons**: 1-2일 구현, 서버·cron 시계 sync 필요
- **Context**: v0.1은 D2 결정대로 `.env` + RUNBOOK 수동 회전. 외부 알림 채널이나 제3자 webhook이 도입되는 시점에 함께 마이그레이션하는 게 자연스럽다.
- **Depends on**: 외부 webhook 도입 계획 (예: Slack/Discord 알림)
- **Where to start**: `shared/api/auth/hmac.ts` 신설, `app/api/cron/*/route.ts`의 `verifyBearer` → `verifyHmac` 교체

### 2. Eval CI 자동 회귀 검증 ✅ 구현됨 (2026-06-17)

- **상태**: 구현 완료. 설계는 `docs/superpowers/specs/2026-06-17-email-classification-eval-design.md`, 구현은 `apps/dashboard/tests/eval/`.
- **설계 진화**: 당초 "운영 `user_action` 자연 레이블링" 구상이었으나, ① 개인정보 커밋 불가 ② 분류기가 거른 메일은 행이 없어 FN(recall) 측정 불가 ③ 중요 트랙은 read/archive 신호가 약함 — 이유로 **합성 fixture 기반**으로 전환. 2계층: Layer 1(매 PR, deterministic recall + severity 스냅샷 + mailing-list 컷, `pnpm test` 포함) / Layer 2(on-prem 수동 `pnpm eval:llm`, 실제 Haiku precision/recall/F1 리포트). GHA는 cli-proxy 내부망 접근 불가라 LLM 정확도는 CI가 아닌 on-prem 측정.
- **베이스라인 (2026-06-16 측정, `apps/dashboard/tests/eval/reports/`)**:
  - deterministic recall = **0.529** — 정규식 prefilter가 답장 필요 메일의 ~47%(암시적 표현 = B 케이스)를 놓침. **상한을 만드는 건 Haiku가 아니라 정규식 prefilter**임을 실측 (모델 업그레이드 논의 시 핵심 근거).
  - 중요 트랙 categoryMacroF1 = **0.853**, importanceAccuracy = **0.765** (Haiku 건강).
- **임계치** (`thresholds.json`): deterministic recall 0.45, 중요 categoryMacroF1 0.75 / importanceAccuracy 0.65. reply LLM 트랙은 **미보정(null)** — 아래 발견 때문.

#### 2-a. 베이스라인이 잡은 발견 — 영어 메일 답장 분류가 reason 40자 제한에 걸림 (별도 PR 필요)

- **What**: 영어 메일에서 Haiku가 영어 `reason`을 생성하면 40자(`classify-thread.ts`의 `LlmResponseSchema reason.max(40)`)를 초과 → Zod 거부 → `classifyWithLLM`이 `llm-unavailable` 반환. `classifyThread.ts`는 이때 deterministic fallback으로 flag를 유지한다.
- **Production 영향**: 영어 junk 메일이 deterministic 패턴(긴급/질문 키워드)을 통과하면, LLM이 걸러줘야 할 것을 reason 길이 거부로 못 걸러 **fallback으로 잘못 flag(FP)** 된다. 영어 사용자에게 답장 트랙 정확도 저하.
- **Why 별도 PR**: 이건 production 분류 동작 변경(40자 한도 완화 또는 reason 언어 강제 등)이라 자체 brainstorm/리뷰 필요. eval에서 고칠 범위 아님.
- **eval 측 follow-up (소규모)**: `run-llm-eval.ts`가 현재 `llm-unavailable`을 skip하는데, production은 deterministic fallback로 flag 유지 → eval이 prefilter-pass 스레드의 `llm-unavailable`을 `predicted:true`로 매핑하면 production을 더 정확히 미러. (지금은 reply LLM 트랙 메트릭이 이 skip으로 오염돼 임계치를 null로 둠.)
- **의의**: eval 시스템의 첫 실제 캐치 — run 1회에 production 결함 발견. 시스템이 의도대로 작동.

### 3. Production OAuth publish (refresh token 7일 만료 제거)

- **What**: Google OAuth Console에서 External Test → Production 전환, refresh token의 7일 만료 제약 제거
- **Why**: v0.1은 D3 결정대로 매주 재로그인 + 외부 알림으로 처리. 서비스 안정화되면 사용자 피로도 제거가 우선순위.
- **Pros**: 재로그인 주기적 멈춤 제거, 사용자 신뢰 증가
- **Cons**: privacy policy URL 작성·호스팅 필요, scope justification 작성, "External (Production) but unverified" 경고 화면이 처음 1회 노출됨 (본인은 무시 가능)
- **Context**: v0.1의 OAuth 만료 처리(`oauth_state = 'reauth_required'`, 외부 알림 메일, 대시보드 배너) 코드는 그대로 남겨둠 — Production publish 후에도 매우 드물게(약 6개월) 재로그인 필요할 수 있음.
- **Depends on**: 30일 dogfooding 완료, privacy policy 페이지 1개 작성 (`/privacy`)
- **Where to start**: Google Cloud Console > OAuth consent screen > "Publish to production"

### 4. 빈 상태 인용구 풀 + 일별 회전

- **What**: v0.1의 한병철 고정 인용구를 인용구 풀(30개+) + 일별 회전 로직으로 교체
- **Why**: 빈 상태는 매일 보이는 화면 — 매일 다른 인용은 "매일 잠시 멈추는 의미"의 작은 보상이 되어 서비스 지속 동기 증가
- **Pros**: 자주 보는 화면의 작은 즐거움, 콘텐츠 큐레이션 자체가 차별점
- **Cons**: 인용구 30개+ 수집·번역·저작권 확인 필요
- **Context**: v0.1 디자인 결정에서 "고정 한병철 인용"으로 시작 (D11). 30일 dogfooding 동안 자주 보이는 화면의 단조로움이 문제로 드러나면 우선순위 상승.
- **Depends on**: v0.1 안정화, 인용구 수집 (공개도메인 우선 — 동양 고전, 시인 등)
- **Where to start**: `shared/lib/quotes.ts`에 `Quote[]` 배열 + `pickQuoteForDate(date: Date): Quote` 함수. 일별 결정적 회전 (해시 기반)

### 5. 중요 이메일 위젯 — Eval CI

- **What**: `important_emails` 분류 결과와 사용자 행동(`read_at`, `archived_at`)을 (입력, 라벨) 페어로 사용한 회귀 eval CI
- **Why**: v0.1 30일 dogfooding으로 자연 레이블링 데이터셋 누적. 프롬프트·모델 변경 시 precision/recall 게이트로 회귀 자동 차단.
- **Pros**: 분류 품질의 안전망
- **Cons**: 1-2일 구현 (eval 스크립트 + GitHub Actions)
- **Depends on**: 30일 dogfooding 완료
- **Where to start**: `scripts/eval/run-important-eval.ts`, reply_needed eval과 동일 인프라 공유

### 6. 중요 이메일 위젯 — 5번째 카테고리 (travel)

- **What**: schedule 카테고리가 비대해지면 항공권·호텔 분리
- **Why**: 여행 중에는 교통 정보가 한 화면에 모이는 게 유용
- **Cons**: 카테고리 추가는 Zod enum + 프롬프트 + UI 라벨 3곳 동시 수정 필요 (테스트 자동 잡힘)
- **Depends on**: schedule 카테고리에 여행 관련 메일 비율 측정 (eval 데이터셋 활용)

### 7. 중요 이메일 위젯 — Outlook 다중 계정 검증

- **What**: 현재 Gmail 추상이 List-Unsubscribe 등 RFC 헤더에만 의존하므로 Outlook도 같은 인터페이스로 동작 가능한지 검증
- **Why**: 이미 답장 필요 위젯의 Outlook 항목과 묶어 진행하면 효율적
- **Depends on**: Outlook OAuth 등록

### 8. widgets/email-digest의 format.ts를 shared/lib로 이동

- **What**: `senderInitials`·`senderDomain`·`formatRelativeKst`이 현재 `widgets/email-digest/lib/format.ts`에 있음. `widgets/important-emails`가 cross-import해서 사용 중 — FSD 규약 위반.
- **Why**: 두 위젯 이상에서 쓰이는 포매터는 shared. 향후 다른 위젯이 늘어나면 이 결정이 더 자명해짐.
- **Where to start**: `src/shared/lib/email-format.ts`로 옮기고 두 widget의 import 경로 갱신.
- **Cons**: 리팩토링 1개 PR — 회귀 위험 거의 없음.

### 9. 위젯별 ErrorBoundary 적용

- **What**: 현재 `app/page.tsx`는 Suspense만 적용. RSC throw 시 Next.js 기본 error.tsx로 fallback. ImportantEmailsErrorState는 정의만 하고 ErrorBoundary로 감싸지 않음.
- **Why**: 한 위젯 실패가 다른 위젯 영향 안 받게 — 기존 디자인 §4.4의 의도.
- **Where to start**: `react-error-boundary` 도입 후 각 Suspense를 `<ErrorBoundary fallback={...}>`로 감싸기.

### 10. shared/lib/log.ts 구조화 로거 도입

- **What**: 현재 `console.warn`이 5곳 (`classify-important.ts`, `classifyImportant.ts`, `markAsRead.ts`, `archiveThread.ts`, `syncInbox.ts`)에 `// TODO(logger)` 주석과 함께 사용됨. 구조화 로거(pino 등) 도입 후 일괄 교체.
- **Why**: ECC TypeScript 규칙(`No console.* in production code`) 준수, 중앙 집중식 로그 레벨 제어, 향후 외부 로그 백엔드 통합.
- **Where to start**: `src/shared/lib/log.ts` 신설 (pino 또는 가벼운 wrapper). 5곳의 `console.warn` 호출을 `log.warn(...)` 으로 교체.
- **Cons**: pino 의존성 추가 (~30KB). 기존 동작과 호환되는 인터페이스 설계 필요.

### 11. 서버 인프라 모니터 — L2 리소스 메트릭 (CPU/MEM)

- **What**: `docker stats --no-stream --format json`을 주기적으로 호출해 컨테이너별 CPU/MEM 사용률 수집. UI에 임계치 초과 경고 + 경량 그래프.
- **Why**: v0.1은 L1 상태 (running/exited/restarting)만 감지. OOM kill 직전이나 CPU 폭주 같은 "running이지만 비정상" 시나리오는 v0.2 영역.
- **Where to start**: `shared/lib/docker/stats.ts` 신설. 수집은 RSC 안에서 매번 호출 또는 cron 컨테이너에 추가. 시계열 보관은 PostgreSQL → 향후 TimescaleDB.
- **Depends on**: v0.1 dogfooding으로 임계치 결정 (예: CPU > 80% 5분 지속, MEM > 90%)

### 12. 서버 인프라 모니터 — L3 로그 패턴 분석

- **What**: 컨테이너 로그에서 ERROR/FATAL 자동 감지 + 일정 비율 초과 시 Web Push 알림.
- **Why**: 사용자가 "이상 알림" 시나리오를 v0.1 요구사항에 포함했지만, history 없이 의미 있는 이상 정의가 어려워 시각 배지로만 가능 (D5).
- **Where to start**: `docker logs --since` + 정규식 매칭 또는 Haiku LLM 분류. Web Push 인프라는 이메일 위젯에서 재사용.
- **Depends on**: L2 메트릭 수집 (이상 신호 통합)

### 13. 서버 인프라 모니터 — Web Push 알림

- **What**: 이상 감지(L1 restart spike, L2 메트릭 임계치, L3 로그 패턴) 시 web-push로 푸시 알림.
- **Why**: v0.1엔 시각 배지만. dogfooding 후 어떤 이상이 알림 가치 있는지 데이터 누적되면 우선순위 상승.
- **Where to start**: `shared/lib/push/`이 이미 있음 (이메일 위젯). subscription 재사용 + 새 payload 타입.

### 14. 서버 인프라 모니터 — Playwright E2E + docker mock shim

- **What**: E2E 테스트 (메인 → 호스트 상세 → restart → 토스트 + audit_logs).
- **Why**: v0.1은 110+ 단위/통합 테스트로 5단계 보안 boundary는 검증되지만, 메인 → 상세 → 액션의 사용자 흐름 회귀는 dogfooding에 의존. v0.2 또는 코드 변경 빈도가 높아질 때 우선순위 상승.
- **Where to start** (plan 보존):
  - `playwright.config.ts` 신설 (webServer + PATH 조작으로 mock shim 활성화)
  - `tests/fixtures/docker-mock-shim.mjs` (실제 docker CLI 대체. `DOCKER_MOCK_SCENARIO=healthy` 등 시나리오 분기)
  - `tests/fixtures/docker-ndjson/{healthy,daemon-down}.ndjson` 픽스처
  - `tests/e2e/server-infra.spec.ts` 3개 시나리오 (메인 카드 / 상세 액션 버튼 노출 / restart 확인 다이얼로그 → 성공 메시지)
- **Cons**: Playwright 설치 + browser 다운로드 (~200MB) + CI 플러밍.
- **Depends on**: 이미 충분히 작동 중인 dogfooding이 회귀 잡지 못하는 사례 등장 시.

### 15. 서버 인프라 모니터 — env 모듈 일관성 (process.env 직접 접근 정리)

- **What**: `runDocker.ts`와 `_runAction.ts`에서 `process.env.DOCKER_CMD_TIMEOUT_MS`/`process.env.ADMIN_EMAILS`를 직접 읽는 부분을 검증된 `env` 모듈로 통일.
- **Why**: 다른 모든 shared 모듈은 `@/shared/config/env`의 `env` 객체를 사용. 이 두 곳만 `process.env`를 직접 읽어 fallback (`?? 10_000`, `?? ""`) 갖고 있는데, env.ts의 Zod schema가 이미 default/required를 강제하므로 fallback은 dead code.
- **Where to start**:
  - `src/shared/lib/docker/runDocker.ts:19-20`: `Number(process.env.DOCKER_CMD_TIMEOUT_MS ?? 10_000)` → `env.DOCKER_CMD_TIMEOUT_MS`
  - `src/features/container-actions/api/_runAction.ts:55`: `process.env.ADMIN_EMAILS ?? ""` → `env.ADMIN_EMAILS`
  - `src/app/servers/[hostName]/page.tsx:51`: 같은 패턴 정리
  - 단, `runDocker` 테스트는 `delete process.env.DOCKER_CMD_TIMEOUT_MS`로 default 확인 — env 모듈로 옮기면 mock 패턴도 함께 수정 필요.
- **Cons**: 작은 리팩토링 + 테스트 mock 한 군데 수정.

### 16. 서버 인프라 모니터 — ESLint boundaries 세부 정책

- **What**: 현재 `eslint.config.mjs`에서 features→features import를 전체 허용 (groupByProject 공유 목적).
- **Why**: 의도는 `lib/`만 공유하고 `ui/state`는 차단인데, `boundaries/element-types`로는 표현 불가. `no-restricted-imports`로 `@/features/*/ui/**` 패턴 차단 추가하면 의도대로 강제.
- **Where to start**: `eslint.config.mjs`에 `no-restricted-imports` 패턴 추가.

### 17. 서버 인프라 모니터 — UI 폴리싱

- **What**: 다호스트 등록 UI, 컨테이너 상세 모달 (라이브 로그 tail), isHidden 토글 UI, project 메타 편집 (displayName/description/category/isPinned).
- **Why**: v0.1엔 host 1대 seed + project 자동 생성으로 UI 없이 시작. dogfooding으로 "이 컨테이너는 안 보이게 하고 싶다" 같은 요구가 누적되면 추가.
- **Where to start**: `widgets/server-overview` 또는 별도 `widgets/host-admin`.

### 18. 서버 인프라 모니터 — Accessibility 폴리싱

- **What**: `🖥` 이모지 `aria-hidden`, `<section aria-labelledby>` 추가, 다른 위젯과 일관된 시맨틱 hierarchy.
- **Where to start**: `widgets/server-overview/ui/ServerOverviewError.tsx:7`, `ServerOverviewCard.tsx`의 `<section>` 요소.

### 19. 서버 인프라 모니터 — Cluster-aware grouping

- **What**: `news-sentiment-prod` + `news-sentiment-analyzer2`처럼 같은 도메인이 여러 compose project로 쪼개진 경우 한 그룹("뉴스 서비스")으로 묶기.
- **Why**: v0.1.1은 compose project 단위로만 그룹화 — 운영자 관점에서 "한 서비스"인데 두세 카드로 분리되어 인지 부담.
- **Pros**: 도메인 단위로 시야 정리, displayName 중복 제거.
- **Cons**: schema 변경 필요 (예: projects에 `cluster_key` 컬럼 추가), groupByProject 재설계.
- **Where to start**: `projects` 테이블에 `cluster_key text` 추가 → seed-projects에서 같은 cluster_key 부여 → groupByProject가 cluster_key 우선 그룹화.

### 20. 서버 인프라 모니터 — 좀비 자동 cleanup (cron)

- **What**: 매시간 cron이 `db:cleanup-projects --apply`를 자동 실행 (선택적 grace period 포함).
- **Why**: v0.1.1은 수동 cleanup. 좀비 발생 빈도가 높아지면 자동화 가치가 커짐.
- **Pros**: 운영자 수동 작업 제거.
- **Cons**: 잠시 stop된 컨테이너의 project row가 의도치 않게 삭제될 수 있어 grace period(예: 24h+ 비활성) 결정 필요. 사용자 명시 동의가 한 번 더 필요한 안건.
- **Where to start**: `app/api/cron/cleanup-projects/route.ts` + grace period 로직.

## MCP — Calendar 파일럿 후속

### 1. getEventDetail tool

- **What**: 단일 이벤트 상세 (description, 전체 attendees) 를 받는 tool
- **Why**: 위젯에서 이벤트 클릭 시 대시보드 내 모달, Claude의 깊은 질의
- **Where to start**: `packages/mcp-calendar/src/tools/get-event-detail.ts`

### 2. HMAC short-lived mediator token (v2)

- **What**: `/api/mcp/credentials/*` 의 정적 bearer를 60초 TTL HMAC로 전환
- **Why**: 정적 bearer 노출 시 Google access token 무한 발급 가능 — 이를 60초로 제한
- **Depends on**: 외부 webhook 도입 시점에 함께 (TODOS #1)
- **Where to start**: `packages/shared-mcp-runtime/src/auth-hmac.ts`

### 3. Tasks placeholder 채우기 (Todoist or Notion MCP)

- **What**: 우측 사이드바의 Tasks 자리를 동일 Hybrid 패턴으로 채움
- **Where to start**: `packages/mcp-tasks` 패키지

### 4. 기존 도메인 → MCP 패키지 추출 마이그레이션

- **What**: email-digest, important-emails, server-overview, host-dashboard를 동일 패턴으로 추출
- **Why**: LLM이 답장 우선순위 추천, 서버 액션 트리거 등 활용 가능
- **Cons**: 위젯 도메인 import → tool import 리팩토링. 단계적 진행.

## 백로그 (확정되지 않음)

- 답장 자동 작성 (A 곁가지) — V0 검증 후 사용자 직접 결정
- 다중 계정 (Outlook 추가)
- Cloud Pub/Sub 실시간 알림 (polling 1시간 간격이 부족할 때)
- Calendar 위젯 (`widgets/calendar-digest`) — `entities/digest` 추상이 그대로 작동하는지 검증
- Tasks 위젯
- Dark mode (DESIGN.md 작성 후)
- 자동 watchtower 배포 (v0.1은 수동 + CI SSH로 충분)
- 서버 인프라 — L4 의존성 진단 (project 내 service 그래프, restart 루프 자동 감지)
- 서버 인프라 — TimescaleDB 연동 (장기 시계열, krdn-timescaledb 활용)
