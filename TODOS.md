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

### 2. Eval CI 자동 회귀 검증

- **What**: GitHub Actions에서 LLM 분류기 프롬프트/모델 변경 시 자동 회귀 테스트 실행 (precision/recall 임계치 pass/fail 게이트)
- **Why**: v0.1의 30일 dogfooding으로 `(분류 결과, 사용자 행동)` 페어가 자동 누적됨. 그 데이터를 자연 레이블링 데이터셋으로 사용. 프롬프트·모델 수정 시 회귀 자동 차단.
- **Pros**: 프롬프트 튜닝의 안전망, 모델 업그레이드 시 회귀 자동 차단
- **Cons**: 1-2일 구현 (eval 스크립트 + GitHub Actions 워크플로우)
- **Context**: v0.1의 `reply_needed` 테이블에 `classifier_version`, `user_action`, `user_action_at` 컬럼이 있어 데이터는 자동 수집된다. v0.2는 이 데이터를 읽어 precision/recall 계산 → CI에서 임계치 비교만 하면 됨.
- **Depends on**: v0.1 30일 dogfooding 완료 (충분한 레이블링 데이터셋 누적)
- **Where to start**: `scripts/eval/run-eval.ts`, `.github/workflows/eval.yml` (PR이 `shared/lib/llm/**` 또는 `entities/email/lib/deterministic-classifier.ts` 수정 시 트리거)

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

## 백로그 (확정되지 않음)

- 답장 자동 작성 (A 곁가지) — V0 검증 후 사용자 직접 결정
- 다중 계정 (Outlook 추가)
- Cloud Pub/Sub 실시간 알림 (polling 1시간 간격이 부족할 때)
- Calendar 위젯 (`widgets/calendar-digest`) — `entities/digest` 추상이 그대로 작동하는지 검증
- Tasks 위젯
- Dark mode (DESIGN.md 작성 후)
- 자동 watchtower 배포 (v0.1은 수동 + CI SSH로 충분)
