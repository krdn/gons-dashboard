# 증권 종목 분석 위젯 (stock-analysis) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 등록한 포트폴리오 종목을 5명 LLM 페르소나 + 합의자가 분석해 대시보드에 표시하는 위젯을 8 PR 에 걸쳐 구축.

**Architecture:** FSD (widgets/features/entities/shared) + `packages/stock-analysis` 도메인 패키지 (saju 미러). lazy fetch + 자산군별 cron 캐싱. 모델 분산 (Claude 3, Codex 2, Gemini 1) 페르소나별 override 가능.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM, PostgreSQL 16, Vitest, Recharts, web-push, Anthropic SDK (Claude Code CLI Proxy 경유).

**Spec:** `docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md`

---

## Phase 1: Scaffold + Schema

Phase 1 상세는 `phase-1-scaffold.md` (별도 파일). 본 문서는 인덱스만 유지.

요약 task list:
- T1.1: packages/stock-analysis 부트스트랩 (package.json, tsconfig, index.ts)
- T1.2: dashboard package.json + Dockerfile 두 stage 패치 (workspace-package-dockerfile-gotcha)
- T1.3: Drizzle 4 테이블 (portfolioHoldings / stockPersonaPreferences / stockAnalysisCache / stockConsensusFlips) + CHECK 제약
- T1.4: entities 3개 (stock / portfolio-holding / stock-analysis) server-client 분리 스켈레톤
- T1.5: 종합 typecheck + lint

---

## Phase 2: Yahoo Adapter

상세 → `phase-2-yahoo-adapter.md`. 요약:
- T2.1: `packages/stock-analysis/src/adapters/yahoo.ts` — quote, 일봉, 펀더멘털, search (5초 timeout + retry 1회)
- T2.2: Vitest mock 테스트 (`global.fetch` mock) — 정상/timeout/rate-limit 케이스
- T2.3: `/api/stock/search` GET route (Yahoo proxy, 디바운스는 클라이언트 책임)
- T2.4: `/api/stock/quote` GET route (배치 quote, NextAuth 인증 필수)
- T2.5: `entities/stock/server.ts` 의 `listMarketQuote` / `fetchYahooSearch` 실제 구현 연결

---

## Phase 3: 페르소나 + 합의 빌더

상세 → `phase-3-personas-consensus.md`. 요약:
- T3.1: Zod schemas (`PersonaAnalysisSchema`, `ConsensusSchema`) — LLM 출력 강제
- T3.2: 5개 페르소나 프롬프트 빌더 (`wallStreet.ts`, `krExpert.ts`, `value.ts`, `growth.ts`, `technical.ts`) — `market_snapshot` 실수치 주입 + "이 수치만 사용" 지시
- T3.3: `consensus/builder.ts` — 성공한 페르소나 결과를 받아 다수결 + 핵심 리스크 정리
- T3.4: `shared/lib/llm/persona-router.ts` — default 매핑 + user overrides 적용
- T3.5: Promise.allSettled 오케스트레이터 (`analyzeStock(symbol, userId)`) — ≥3명 성공이면 합의 진행
- T3.6: Mock LLM unit 테스트 (모델별 호출 분산 검증)

---

## Phase 4: Portfolio CRUD UI

상세 → `phase-4-portfolio-crud.md`. 요약:
- T4.1: `features/stock-portfolio-crud/api/actions.ts` Server Actions (`addHolding`, `updateHolding`, `deleteHolding`)
- T4.2: `features/stock-portfolio-crud/ui/TickerSearchInput.tsx` — Yahoo autocomplete (300ms 디바운스)
- T4.3: `features/stock-portfolio-crud/ui/PortfolioTable.tsx` — 인라인 편집 (셀 클릭 → 입력 토글)
- T4.4: `features/stock-persona-config/ui/PersonaModelPicker.tsx` — 5명 + 합의자 × Claude/Codex/Gemini 라디오
- T4.5: `features/stock-persona-config/api/actions.ts` — `updatePersonaOverrides`
- T4.6: `widgets/stock-analysis/PortfolioSettingsModal.tsx` — Portfolio 탭 + LLM 탭 컨테이너

---

## Phase 5: Widget Card + Detail Modal

상세 → `phase-5-widget-detail.md`. 요약:
- T5.1: `shared/ui/PriceChart.tsx` — Recharts 라이트 (1D/1W/1M/3M/1Y 토글 + RSI/MA20/MA60 오버레이). 번들 측정 (`pnpm build --analyze`) 후 lightweight-charts 전환 여부 결정 (spec §10).
- T5.2: `widgets/stock-analysis/StockAnalysisCard.tsx` — RSC, 헤드라인 종목 hero + 리스트 (옵션 3). 캐시 hit 만 처리, miss 는 Phase 6 에서.
- T5.3: `widgets/stock-analysis/StockAnalysisSkeleton.tsx` — Suspense fallback
- T5.4: `widgets/stock-analysis/StockDetailModal.tsx` — A 레이아웃 ("use client", 합의 hero + 5 페르소나 탭 + 차트 + 펀더멘털 + 면책 footer)
- T5.5: `entities/stock-analysis/client.ts` 의 `ConsensusBadge`, `PersonaTab` 부품 추가
- T5.6: `app/page.tsx` 좌 7-grid 에 `<StockAnalysisCard />` 추가

---

## Phase 6: Lazy Trigger + Polling

상세 → `phase-6-lazy-polling.md`. 요약:
- T6.1: `features/stock-analysis-server/api/trigger.ts` — `triggerAnalysis(symbol)` Server Action (rate-limit 가드 분당 1회/사용자/페르소나)
- T6.2: `app/api/stock/analyze/route.ts` — POST, NextAuth 인증, 백그라운드 처리 (setImmediate-style — Next.js `after()` 사용)
- T6.3: `features/stock-analysis-server/api/status.ts` — `pollAnalysisStatus(symbol)` (분석 진행 상태 / 완료 결과)
- T6.4: `widgets/stock-analysis/ui/usePollingAnalysis.ts` — 클라이언트 폴링 hook (5초 간격, 60초 timeout)
- T6.5: `StockAnalysisCard` 의 캐시 miss UI — "분석 중 ⏳ (평균 45초)" placeholder + 폴링 연결

---

## Phase 7: Cron + Flip Push

상세 → `phase-7-cron-flip.md`. 요약:
- T7.1: `apps/cron/src/jobs/stockAnalyze.ts` — 자산군 라우팅 (KR 16:30 / US+CRYPTO+COMMODITY 06:30)
- T7.2: `app/api/cron/stock-analyze/route.ts` — POST `?market=KR|US_GLOBAL`, Bearer 토큰 인증, 등록 종목 일괄 재분석
- T7.3: `features/stock-push-flip/api/detect.ts` — `detectConsensusFlip(yesterday, today)` (prompt_version 일치 + 24h 1회 cap)
- T7.4: `features/stock-push-flip/api/notify.ts` — web-push 발송 (기존 push_subscriptions 재사용)
- T7.5: `stock_consensus_flips` insert + notified_at 갱신

---

## Phase 8: Browser 검증 + 운영 배포

상세 → `phase-8-deploy-verify.md`. 요약:
- T8.1: 운영 DB 마이그레이션 적용 (`pnpm db:migrate --i-know-this-is-prod`)
- T8.2: 로컬 dogfooding — 종목 3종 등록 (삼성전자 / NVIDIA / BTC) → 헤드라인 + 모달 + 모델 override 검증
- T8.3: docker compose pull/up → `/api/health` + `/api/stock/search?q=test` 401 응답 확인 (배포 완료 시그널)
- T8.4: CLAUDE.md Gotcha 추가 (구현 중 발견한 새 함정이 있다면)
- T8.5: 운영 dogfooding — 실제 cron 1회 fire 후 stock_analysis_cache row 확인

---

## 실행 순서 및 PR 단위

- **Phase 1 ~ Phase 7**: 각 1 PR (총 7 PR)
- **Phase 8**: 운영 배포 verify (no PR, runbook 만)

각 Phase 의 상세 task 는 별도 파일 (`docs/superpowers/plans/2026-05-21-stock-analysis-widget/phase-N-*.md`) 로 분리. 다음 호흡에서 Phase 1-2 부터 상세 작성.

---

## 횡단 관심사

### LLM 모델 호출 추상화

기존 `shared/lib/llm/anthropic.ts` 가 Anthropic SDK 만 wrapping. saju v0.3.2 의 model picker 가 Claude/Codex/Gemini 를 어떻게 호출하는지 패턴 참조 — Phase 3 에서 동일 패턴 재사용. 신규 wrapper 작성보다 saju 의 라우터 import 검토.

### 빌링 실측 (spec §10)

Phase 1 종료 후 (또는 Phase 3 첫 LLM 호출 시점에) Claude Code CLI Proxy 가 토큰 카운트로 빌링하는지 flat rate 인지 확인. spec §6.1 의 비용 추정 수치를 실측치로 갱신.

### Drizzle snapshot 충돌

Phase 1 T1.3 에서 `db:generate` 시 collision 발생 가능 — 메모리 `drizzle-snapshot-id-collision` 참조해 `id` / `prevId` 두 줄만 수정. 별도 commit.

### Docker workspace gotcha

Phase 1 T1.2 에서 `apps/dashboard/Dockerfile` 의 build/prod 두 stage 모두에 `COPY packages/stock-analysis` 추가 필수 — 메모리 `workspace-package-dockerfile-gotcha`. main 배포 시 module-not-found 로 조용히 실패하는 사례 회피.

### Push 알림 면책

Phase 7 알림 텍스트: "삼성전자 합의가 BUY → HOLD 로 전환되었습니다. 자세히 보기 →" 형식. **투자 권유 단어 (매수/매도) 단독 사용 금지** — "합의 전환" / "분석 결과 변경" 등 중립 표현.

### 면책 텍스트 (반복 표시 위치)

1. 자세히 보기 모달 footer (T5.4)
2. 포트폴리오 설정 모달 footer (T4.6)
3. Push 알림 본문 footer (T7.4) — "본 알림은 LLM 가상 의견이며 투자 자문이 아닙니다"

---

## Definition of Done (spec §8 미러)

1. ✅ 대시보드 ⚙ → 포트폴리오 모달 → 종목 추가 가능 (Phase 4)
2. ✅ 좌 7-grid 에 StockAnalysisCard — 옵션 3 (Phase 5)
3. ✅ 자세히 보기 모달 A 레이아웃 (Phase 5)
4. ✅ LLM 탭 페르소나별 모델 override (Phase 4)
5. ✅ cron 자산군별 라우팅 + flip push (Phase 7)
6. ✅ 면책 텍스트 모달 footer (Phase 5)
7. ✅ Edge case UI (각 Phase 에 분산)
8. ✅ 테스트: unit + integration + e2e 1 happy path (각 Phase TDD)

---

다음 호흡에서 Phase 1 상세 task 를 별도 파일 `2026-05-21-stock-analysis-widget/phase-1-scaffold.md` 로 작성. 본 인덱스는 8 Phase 의 윤곽만 유지.
