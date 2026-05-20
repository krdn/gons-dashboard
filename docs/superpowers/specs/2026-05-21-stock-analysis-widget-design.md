# 증권 종목 분석 위젯 (stock-analysis) — 설계

- **작성일**: 2026-05-21
- **상태**: Design (브레인스토밍 합의 완료, plan 단계 진입 대기)
- **선행 결정**: [decision-monorepo-kept-2026-05-15] · saju v0.3 narrative 패턴 미러
- **다음 단계**: `superpowers:writing-plans` → 구현 계획 (PHASES.md / plan documents)

---

## 0. 요약

| 항목 | 결정 |
|---|---|
| 자산군 | 주식 (KOSPI/KOSDAQ/NYSE/NASDAQ) + 크립토 + 원자재 |
| 데이터 소스 | Yahoo Finance (시세/일봉/펀더멘털/search) + LLM 검색 도구 (뉴스 보강) |
| LLM 페르소나 | 5명 (월스트리트/한국/가치/성장/기술) + 합의자 1명 |
| 모델 매핑 | Claude×3, Codex×2, Gemini×1 (사용자 override 가능) |
| 분석 트리거 | lazy fetch + 일 2회 cron (KST 16:30 / 06:30) |
| 캐시 | 글로벌 캐시 24h TTL + `prompt_version` 무효화 |
| 포트폴리오 입력 | 티커 + 수량 + 평단 + (선택)매수일 |
| CRUD 위치 | 위젯 우상단 ⚙ → 설정 모달 (LLM 탭 포함) |
| 위젯 카드 | 옵션 3 — 헤드라인 종목 hero + 리스트 (좌 7-grid) |
| 자세히 보기 모달 | A 레이아웃 — 합의 hero + 페르소나 5명 탭 |
| 차트 | Recharts 라이트 (RSI/MA20/MA60) |
| 종목 검색 | Yahoo Finance `v1/finance/search` autocomplete |
| 알림 | web-push, 합의 flip (BUY ↔ HOLD ↔ SELL) 시에만 |
| FSD | widget 1 + features 4 + entities 3 (server/client 분리) + packages 1 |
| DB | 4 테이블 |
| 예상 비용 | ~$5.5/일 (10종목, 일 1회 cron + 글로벌 캐시) |
| 면책 | 모달 footer 고정 (투자자문 아님) |

---

## 1. 시스템 개요

**위젯 이름:** `stock-analysis` (FSD widget slice, `apps/dashboard/src/widgets/stock-analysis`).

**한 줄 요약:** 사용자가 등록한 포트폴리오 종목을 5명의 LLM 페르소나가 각자 분석하고, 6번째 모델이 합의(consensus)를 만들어 대시보드에 보여주는 위젯.

### 1.1 도메인 자산군

Yahoo Finance 가 통합 커버하므로 한 어댑터로 처리:

- **주식**: KOSPI/KOSDAQ (`005930.KS`, `091990.KQ`), NYSE/NASDAQ (`AAPL`, `NVDA`)
- **암호화폐**: `BTC-USD`, `ETH-USD`
- **원자재**: `GC=F` (Gold), `CL=F` (Crude Oil), `SI=F` (Silver)

`symbol` 컬럼 하나로 자산군 무관 통합 처리. `asset_class` 컬럼은 UI 표시·검색 필터용.

### 1.2 페르소나 5명 + 합의자 1명

| 페르소나 | 관점 | Default 모델 | 강점 |
|---|---|---|---|
| 월스트리트 전문가 | 글로벌 IB 영문 리서치 톤 | Claude (claude-opus-4-7) | 영문 금융 뉘앙스 |
| 한국 전문가 | 국내 증권사 · KRX 미시구조 | Claude | 한국어 톤 안정 |
| 가치 투자 | PER/PBR/DCF 정량 분석 | Codex (gpt-5.3-codex) | 정량 추론 |
| 성장 투자 | 모멘텀 · 검색 기반 최신 | Gemini | 검색·멀티모달 |
| 기술적 분석 | RSI/MA/거래량 | Codex | 수치 일관성 |
| **합의 요약자** | 5명 의견 통합 (다수결 + 핵심 리스크) | Claude | 통합 서사 |

분포: **Claude 3, Codex 2, Gemini 1**. 모델별 rate-limit 균형. 설정 모달 LLM 탭에서 페르소나별 override 가능 (`stock_persona_preferences.overrides` jsonb).

LLM 호출은 Claude Code CLI Proxy (`ANTHROPIC_BASE_URL`) 를 통해 Anthropic SDK 가 자동 처리 — 기존 `shared/lib/llm/anthropic.ts` 패턴 재사용.

---

## 2. 데이터 흐름

```
[사용자 대시보드 접속]
        │
        ▼
[RSC: StockAnalysisCard]
  ├─ getUserPortfolio(userId) ── portfolio_holdings
  ├─ getCachedAnalysis(symbols, today) ── stock_analysis_cache
  └─ 캐시 hit → 헤드라인 + 리스트 렌더 (옵션 3 레이아웃)
        │
        ▼ (캐시 miss)
[Server Action: triggerAnalysis(symbol)]
  └─ 비동기 백그라운드 → 즉시 "분석 중 ⏳" placeholder + 클라이언트 폴링 시작
        │
        ▼
[packages/stock-analysis (도메인 패키지)]
  ├─ fetchMarketData(symbol)
  │   └─ Yahoo Finance: quote + 일봉(1Y) + 펀더멘털 (PER/PBR/배당)
  ├─ Promise.allSettled([
  │     analyzePersona("wall-street", Claude),
  │     analyzePersona("kr-expert",  Claude),
  │     analyzePersona("value",      Codex),
  │     analyzePersona("growth",     Gemini),
  │     analyzePersona("technical",  Codex),
  │   ])
  ├─ buildConsensus(성공한 결과들, Claude)
  └─ INSERT INTO stock_analysis_cache
        │
        ▼
[cron: KST 16:30 + 06:30]
  ├─ 등록된 portfolio_holdings 전체 재분석
  ├─ 어제 합의 vs 오늘 합의 비교
  └─ flip 시 stock_consensus_flips INSERT → web-push
```

### 2.1 핵심 결정

- **시세는 항상 fresh**: Yahoo quote 는 RSC 매 렌더마다 호출. LLM 분석만 24h 캐시.
- **부분 실패 허용**: Promise.allSettled — 5명 중 3명 이상 성공이면 합의자에게 successful 결과만 전달. 0~2명 성공이면 cache 저장 안 함 (saju `verifyConsensus` 미러).
- **글로벌 캐시 우선**: `stock_analysis_cache.user_id = NULL` → 같은 종목·같은 날 N명 공유. 평단 인식 분석은 v1.1 이후.
- **lazy + cron 병행**: 사용자 미접속이어도 다음날 아침 최신 상태. flip 알림이 cron 에 종속.

### 2.2 latency 처리

| 단계 | 시간 |
|---|---|
| Yahoo Finance fetch (병렬) | ~500ms |
| 페르소나 5명 LLM (병렬) | 15-30초 (가장 느린 모델 기준) |
| 합의자 (5명 결과 후) | 10-20초 |
| **총 cold-start** | **~30-60초** |
| 캐시 hit | <100ms |

UX: 즉시 "분석 중 ⏳ (평균 45초)" placeholder → 클라이언트 5초 간격 폴링 → 페르소나 완료 시 점진 노출.

---

## 3. FSD 슬라이스 분해

### 3.1 파일 구조

```
apps/dashboard/src/
├── widgets/
│   └── stock-analysis/                          [NEW]
│       ├── index.ts                             ← barrel
│       ├── StockAnalysisCard.tsx                ← RSC, 헤드라인+리스트 (옵션 3)
│       ├── StockAnalysisSkeleton.tsx            ← Suspense fallback
│       ├── StockDetailModal.tsx                 ← "use client", A 레이아웃
│       └── PortfolioSettingsModal.tsx           ← "use client", CRUD + LLM 설정
│
├── features/
│   ├── stock-portfolio-crud/                    [NEW]
│   │   ├── ui/ — PortfolioTable, TickerSearchInput (autocomplete)
│   │   ├── api/ — Server Actions: addHolding, updateHolding, deleteHolding
│   │   ├── model/ — Zod schemas
│   │   └── lib/
│   │
│   ├── stock-analysis-server/                   [NEW]
│   │   ├── api/ — triggerAnalysis, getCachedAnalysis, pollAnalysisStatus
│   │   └── lib/ — 부분 실패 처리, rate-limit 가드
│   │
│   ├── stock-persona-config/                    [NEW]
│   │   ├── ui/ — PersonaModelPicker (5명 × 3 모델)
│   │   └── api/ — updatePersonaOverrides
│   │
│   └── stock-push-flip/                         [NEW]
│       └── api/ — detectConsensusFlip, sendFlipNotification
│
├── entities/
│   ├── stock/                                   [NEW]
│   │   ├── server.ts  ← listMarketQuote, fetchYahooSearch
│   │   ├── client.ts  ← StockPriceBadge, StockTickerChip
│   │   └── model/quote-types.ts
│   │
│   ├── portfolio-holding/                       [NEW]
│   │   ├── server.ts  ← Drizzle queries (getHoldings, upsertHolding)
│   │   ├── client.ts  ← HoldingRow, types
│   │   └── model/
│   │
│   └── stock-analysis/                          [NEW]
│       ├── server.ts  ← stock_analysis_cache CRUD
│       ├── client.ts  ← ConsensusBadge, PersonaTab UI 부품
│       └── model/{persona-types, consensus-types}
│
├── shared/
│   ├── ui/PriceChart.tsx                        [NEW] Recharts 라이트
│   └── lib/llm/persona-router.ts                [NEW] default + override 적용
│
└── app/api/
    ├── stock/
    │   ├── analyze/route.ts                     [NEW] POST 인증
    │   ├── search/route.ts                      [NEW] GET Yahoo search proxy
    │   └── quote/route.ts                       [NEW] GET Yahoo quote proxy
    └── cron/stock-analyze/route.ts              [NEW] POST Bearer 토큰

packages/
└── stock-analysis/                              [NEW] (saju 미러)
    ├── package.json (@gons/stock-analysis)
    └── src/
        ├── adapters/yahoo.ts
        ├── personas/{wallStreet,krExpert,value,growth,technical}.ts
        ├── consensus/builder.ts
        ├── schemas/                             (Zod: PersonaAnalysis, Consensus)
        └── index.ts

apps/cron/src/jobs/stockAnalyze.ts               [NEW]
```

### 3.2 의존성 검증

- 방향: `app → widgets → features → entities → shared` ✓
- `widgets/stock-analysis` → `features/stock-*` ✓
- `features/stock-portfolio-crud` → `entities/portfolio-holding`, `entities/stock` ✓
- `features/stock-analysis-server` → `entities/stock-analysis`, `@gons/stock-analysis` ✓
- entities 간 직접 참조 없음 ✓
- entity barrel **server/client 분리** (CLAUDE.md Gotcha #1 패턴) ✓

### 3.3 packages 분리 근거

- saju 와 동일한 도메인 분리 — 페르소나·프롬프트·Yahoo 어댑터를 dashboard 외부로 추출
- 향후 MCP 도구로 노출 가능 (Phase v2.0)
- polyrepo 분리는 **하지 않음** (`decision-monorepo-kept-2026-05-15` 결정 준수)

---

## 4. DB 스키마 (Drizzle ORM, PostgreSQL 16)

### 4.1 `portfolio_holdings`

```sql
CREATE TABLE portfolio_holdings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol          text NOT NULL,        -- 'AAPL', '005930.KS', 'BTC-USD', 'GC=F'
  asset_class     text NOT NULL,        -- 'stock' | 'crypto' | 'commodity'
  market          text NOT NULL,        -- 'NASDAQ' | 'NYSE' | 'KRX' | 'CRYPTO' | 'COMMODITY'
  display_name    text NOT NULL,        -- Yahoo search 결과 cache
  quantity        numeric(20, 8) NOT NULL CHECK (quantity > 0),
  avg_cost        numeric(20, 8) NOT NULL CHECK (avg_cost >= 0),
  purchased_at    date,                 -- nullable
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);
CREATE INDEX idx_portfolio_holdings_user ON portfolio_holdings(user_id);
```

### 4.2 `stock_persona_preferences`

```sql
CREATE TABLE stock_persona_preferences (
  user_id    text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- jsonb: { wallStreet: 'claude'|'codex'|'gemini', krExpert: ..., value: ..., growth: ..., technical: ..., consensus: ... }
  -- key 없으면 default 매핑 사용
  overrides  jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.3 `stock_analysis_cache`

```sql
CREATE TABLE stock_analysis_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text NOT NULL,
  analysis_date   date NOT NULL,        -- KST 기준
  user_id         text REFERENCES users(id) ON DELETE CASCADE,
                                         -- NULL: 글로벌 캐시 (v1 기본)
                                         -- NOT NULL: 평단 인식 분석 (v1.1+)
  personas        jsonb NOT NULL,       -- { wallStreet: {...}, krExpert: {...}, ... }
  consensus       jsonb NOT NULL,       -- { verdict, score, oneLineConsensus, agreements, disagreements, riskRanking, modelUsed }
  market_snapshot jsonb NOT NULL,       -- { price, change_pct, marketCap, per, pbr, dividend_yield, debt_ratio, ... }
  prompt_version  text NOT NULL,        -- 'v1.0'
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, analysis_date, user_id)
);
CREATE INDEX idx_stock_cache_lookup ON stock_analysis_cache(user_id, symbol, analysis_date DESC);
```

### 4.4 `stock_consensus_flips`

```sql
CREATE TABLE stock_consensus_flips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        text NOT NULL,
  from_verdict  text NOT NULL,
  to_verdict    text NOT NULL,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz             -- NULL = push 미발송 (재시도용)
);
CREATE INDEX idx_flips_pending ON stock_consensus_flips(notified_at) WHERE notified_at IS NULL;
```

### 4.5 스키마 결정 근거

1. `symbol` Yahoo 표준 — 한 컬럼으로 자산군 무관 처리.
2. `stock_analysis_cache.user_id` nullable — 글로벌 캐시 (LLM 호출 1회로 N명 서빙). 평단 인식은 v1.1.
3. `prompt_version` — saju 패턴. 프롬프트 개선 시 기존 캐시 자동 무효.
4. `stock_consensus_flips` 별도 테이블 — push 실패 재시도 + 사용자 알림 히스토리.
5. `stock_persona_preferences.overrides` jsonb — 페르소나 추가 시 마이그레이션 없이 확장.

### 4.6 마이그레이션

`pnpm db:generate` → `pnpm db:migrate --i-know-this-is-prod` (운영 DB 가드). 신규 테이블만 추가하므로 기존 데이터 영향 없음.

---

## 5. UI / UX 상세

### 5.1 위젯 카드 (대시보드) — 옵션 3

좌 7-grid 영역. email-digest 와 톤 일관.

- **헤드라인 영역**: 합의가 가장 강한 종목 1개 (5/5 또는 4/5)
  - 라벨 "▶ 오늘의 시선 · 5명 중 N명 매수"
  - 종목명 / 평가손익 / 합의 한 줄 (인용)
  - 그라데이션 배경 (BUY 녹, HOLD 주, SELL 적)
- **리스트 영역**: 나머지 종목 (한 줄씩) — 티커 · 합의 뱃지 · 평가손익 %
- **하단**: "전체 보기 →" (자세히 보기 모달 진입)
- **우상단 ⚙**: 설정 모달 (CRUD + LLM)

### 5.2 자세히 보기 모달 — A 레이아웃 (합의 우선 + 페르소나 탭)

- **헤더**: 종목명 + 티커 + 현재가 + 전일대비 + 즐겨찾기 별
- **합의 hero** (상단 항상 표시):
  - "▶ 합의: BUY 4/5 · 핵심 리스크 2개"
  - 합의자 한 줄 요약 (3-4 문장)
  - 의견 갈림 지점 / 공통 결론 / 핵심 리스크 ranked
- **공통 데이터 영역**:
  - Recharts `PriceChart` — 1D/1W/1M/3M/1Y 토글 + RSI/MA20/MA60 오버레이
  - 펀더멘털 카드 (PER/PBR/배당/부채비율 등) — Yahoo 기준
- **페르소나 탭** (5개): 월스트 / 한국 / 가치 / 성장 / 기술
  - 각 탭 — 한 줄 결론 + 본문 (300-600자) + 키 메트릭 + 사용 모델 뱃지
  - 우상단 "재생성" 버튼 (rate-limit 분당 1회)
- **footer 면책**: "본 분석은 LLM 페르소나의 가상 의견이며 투자 자문이 아닙니다. 실제 투자 결정은 본인 책임입니다."

### 5.3 설정 모달 (⚙ → Portfolio + LLM 탭)

**Portfolio 탭:**
- 포트폴리오 테이블 (한 행 = 한 종목)
  - 컬럼: 티커 / 종목명 / 자산군 / 수량 / 평단 / 매수일 / 액션 (수정 · 삭제)
  - 인라인 편집 (셀 클릭)
- 하단 "+ 종목 추가" → TickerSearchInput (Yahoo autocomplete) → 수량 + 평단 + 매수일 입력 → 추가

**LLM 탭:**
- 페르소나 5명 + 합의자 1명 × Claude/Codex/Gemini 라디오
- 변경 즉시 `stock_persona_preferences.overrides` 저장
- "기본값으로 리셋" 버튼

### 5.4 종목 검색 (autocomplete)

- Yahoo `https://query2.finance.yahoo.com/v1/finance/search?q=<keyword>`
- 디바운스 300ms (Phase 2 에서 실측 후 조정)
- 결과 카드: 티커 / 거래소 / 종목명 / 자산군 아이콘
- 검색 결과 클릭 → 자동으로 symbol / asset_class / market / display_name 채워짐

---

## 6. 비용 · 성능 · 리스크

### 6.1 비용 추정

종목당 LLM 호출 6회 (페르소나 5 + 합의 1).

| 모델 | 호출 수 | 가정 입출력 | 호출당 비용 |
|---|---|---|---|
| Claude Opus 4.7 | 3 | in 2k / out 1.5k | ~$0.13 |
| Codex (gpt-5.3) | 2 | in 2k / out 1.5k | ~$0.05 |
| Gemini | 1 | in 2k / out 1.5k | ~$0.03 |
| **종목당** | | | **~$0.55** |

일 시나리오 (글로벌 캐시 적용):
- 10종목 × 2회/일 cron (KST 16:30 + 06:30) = **~$11/일** (월 ~$330) — 한국 마감 후 한국 종목 + 미국 마감 후 미국 종목, 종목별로는 하루 1회
- **자산군별 최적화**: 한국 종목은 KST 16:30 만, 미국 종목은 KST 06:30 만, 크립토/원자재는 06:30 만 — 종목당 1회/일 → **~$5.5/일** (월 ~$165) ✓
- 사용자가 수동 재생성 안 누르면 추가 비용 0

**컨트롤 장치:**
1. 글로벌 캐시 (`user_id NULL`) — N명이 같은 종목 보유해도 LLM 1회
2. 24h TTL + `prompt_version` 무효화
3. 수동 재생성은 페르소나 단위 (1명만 ~$0.10)
4. 종목 수 가이드: 10종목 권장, 20종목 hard cap

**참고:** Claude Code CLI Proxy 의 빌링 방식 (토큰 카운트 vs flat rate) 확인 필요 — Phase 1 에서 실측.

### 6.2 성능

위 2.2 참조. cold-start 30-60초, warm <100ms.

### 6.3 주요 리스크 + 완화

| # | 리스크 | 완화 |
|---|---|---|
| R1 | Yahoo Finance unofficial — API 끊김 / rate-limit | adapter 분리 → 향후 KIS/Polygon 교체. v1: 5초 timeout + retry 1회 |
| R2 | LLM 환각 (가짜 PER / 가짜 뉴스) | Zod schema 강제 + `market_snapshot` 실수치를 프롬프트에 명시 주입. "이 수치만 사용" 지시 |
| R3 | LLM 비용 폭주 | 페르소나 단위 재생성 rate-limit (분당 1회/사용자/페르소나) |
| R4 | 투자자문 법적 리스크 | 모달 footer 면책 고정 (saju 패턴 미러) |
| R5 | 모델 1개 장애 | Promise.allSettled → ≥3명 성공이면 진행. 누락 페르소나는 UI 명시 + 재시도 버튼 |
| R6 | Yahoo 한국 종목 일부 누락 (코스닥 소형주, 일부 ETF) | "해당 종목 데이터 없음" UX. KIS 폴백은 v1.1 |
| R7 | flip 알림 false positive | `prompt_version` 일치 확인 + 같은 종목 24h 1회 cap |

### 6.4 Out of Scope (v1.0)

- 백테스팅 / 과거 성과 시뮬레이션
- 절대 가격 알람 (평단 ±X% 도달)
- 옵션 / 선물 / 파생 상품
- 종목 비교 (A vs B)
- 차트 위 페르소나 코멘트 오버레이
- KIS OpenAPI 실시간 시세
- 평단 인식 개인화 분석
- CSV/PDF 포트폴리오 import

---

## 7. Phase 분해 (writing-plans 입력용)

| Phase | 범위 | 단위 |
|---|---|---|
| **P1: Scaffold + Schema** | `packages/stock-analysis` 생성, Drizzle 4 테이블 migration, entities barrel (server/client 분리) | 1 PR |
| **P2: Yahoo Adapter** | `adapters/yahoo.ts` (quote / 일봉 / 펀더멘털 / search), Vitest mock 테스트, `/api/stock/search` + `/api/stock/quote` | 1 PR |
| **P3: 페르소나 + 합의 빌더** | 5 페르소나 프롬프트 (Zod 출력 강제), 합의 빌더, `persona-router.ts`, Promise.allSettled, Mock LLM 테스트 | 1 PR |
| **P4: Portfolio CRUD UI** | `features/stock-portfolio-crud` + `PortfolioSettingsModal` (인라인 편집 + autocomplete) + Server Actions + LLM 탭 | 1 PR |
| **P5: Widget Card + Detail Modal** | `widgets/stock-analysis/StockAnalysisCard` (옵션 3) + `StockDetailModal` (A 레이아웃) + `shared/ui/PriceChart` + Suspense + 면책 footer | 1 PR |
| **P6: Lazy Trigger + Polling** | `triggerAnalysis` Server Action + 백그라운드 워커 (saju lazy 미러) + 클라이언트 폴링 hook + 재생성 rate-limit | 1 PR |
| **P7: Cron + Flip Push** | `apps/cron/jobs/stockAnalyze.ts` (자산군 라우팅 — 한국 종목 KST 16:30, 미국/크립토/원자재 KST 06:30) + `/api/cron/stock-analyze?market=KR\|US_GLOBAL` (Bearer) + `detectConsensusFlip` + web-push + flip 로그 | 1 PR |
| **P8: Browser 검증 + 문서** | 실제 종목 3-5개 dogfooding + CLAUDE.md Gotcha 추가 (있다면) + docs/agents 업데이트 | 1 PR |

총 8 PR. saju v0.3 Phase 분해 리듬과 동일.

---

## 8. Definition of Done (v1.0)

1. 사용자가 대시보드 ⚙ → 포트폴리오 모달 → 종목 추가 (Yahoo autocomplete + 수량 + 평단) 가능
2. 좌 7-grid 에 `StockAnalysisCard` 렌더 — 헤드라인 + 리스트 (옵션 3)
3. 클릭 → 자세히 보기 모달 (A 레이아웃) — 합의 hero + 페르소나 5 탭 + Recharts 차트 + 펀더멘털
4. 설정 모달 LLM 탭 → 페르소나별 모델 (Claude/Codex/Gemini) override 변경 가능
5. cron KST 16:30 + 06:30 등록 종목 재분석 → flip 시 web-push
6. 면책 텍스트 모달 footer 고정
7. Edge case UI: 종목 데이터 없음 / LLM 부분 실패 / 캐시 만료 / rate-limit
8. 테스트: unit (페르소나 빌더, 합의 빌더, Yahoo adapter), integration (RSC + Server Action + DB), e2e (포트폴리오 CRUD 1 happy path)

---

## 9. Backlog (v1.0 이후)

- **v1.1**: KIS OpenAPI 폴백 (Yahoo 누락 종목)
- **v1.2**: 평단 인식 개인화 분석 (`user_id` 별 cache)
- **v2.0**: 절대 가격 알람, 종목 비교 모달, 백테스팅
- **v2.0**: MCP 서버화 (`packages/mcp-stock-analysis`)

---

## 10. 후속 — plan 단계에서 정밀화

1. Recharts vs lightweight-charts 최종 선택 — Phase 5 에서 번들 크기 측정 후
2. Yahoo search 디바운스 시간 — Phase 2 실측 후
3. Claude Code CLI Proxy 빌링 방식 (토큰 vs flat) — Phase 1 실측

---

## 참고 문서

- saju v0.3 narrative 패턴: `docs/superpowers/specs/2026-05-08-saju-tri-v0.3-design.md` (해당 일자 spec)
- entity barrel server/client 분리: `docs/superpowers/specs/2026-05-15-entity-barrel-seam-deepening.md`
- monorepo 유지 결정: 메모리 `decision-monorepo-kept-2026-05-15`
- 워크스페이스 패키지 Dockerfile 주의: 메모리 `workspace-package-dockerfile-gotcha`
- Drizzle snapshot 충돌 복구: 메모리 `drizzle-snapshot-id-collision`
