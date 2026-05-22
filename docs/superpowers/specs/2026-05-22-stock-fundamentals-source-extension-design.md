# Stock Analysis 펀더멘털 데이터 소스 확장 (DART) — Design

**날짜**: 2026-05-22
**범위**: PR 2 (KRX 종목 한정), 미국 종목은 PR 3
**선행**: PR #119 (value null 허용), PR #120 (yahoo-finance2 마이그레이션), PR #121 (MA/RSI fix — rebase 필요)
**관련 spec**:
- `2026-05-21-stock-analysis-widget-design.md` (위젯 전체 설계)
- `2026-05-21-krx-symbol-master-db-design.md` (Phase 1.1 KRX OpenAPI 도입)

---

## 1. 배경

2026-05-22 삼성전자 005930.KS 위젯 스크린샷에서 5 페르소나 분석의 데이터 갭이 발견됨 — 시가총액/PER/PBR/배당 4 카드 모두 "—" 표시, value 페르소나 실패, wallStreet/krExpert 의 fabricated keyMetrics.

진단 과정에서 PR #119 (value null keyMetrics 허용) + PR #120 (yahoo-finance2 라이브러리 마이그레이션 — crumb 인증 자동 처리) 가 머지되어 갭이 부분적으로 회복됨:

| 필드 | yahoo-finance2 회복 여부 (005930.KS / 035420.KS / 000660.KS 실증) |
|---|---|
| `marketCap` | ✅ 회복 |
| `trailingPE` | ❌ null |
| `forwardPE` | ✅ 회복 (5.56 / 13.53 / 5.08) |
| `priceToBook` (PBR) | ❌ **여전히 null** |
| `dividendYield` (배당) | ❌ **여전히 null** |

**PR 2 의 좁아진 목표**: KR 종목의 **PBR 과 배당수익률** 을 DART trailing 재무로 자체 계산해 채움. 동시에 `value`/`growth` 페르소나가 trailing 매출 성장률·영업이익률 같은 정량 근거를 사용하도록 DART trailing 재무 전체를 snapshot 에 노출. Yahoo 펀더멘털 (marketCap, forwardPE) 은 그대로 유지 — DART 는 **보강 (overlay)** 이지 대체가 아님.

### 1.1 PER 의 의미 변화 — 의도적 수용

Yahoo 의 `trailingPE` 는 KR 종목에 null 이라 `forwardPE` 로 폴백됨. 이는 `value` 페르소나 프롬프트의 "PER 동종업 비교 + 배당 안정성" 분석에서 **trailing → forward 로 의미가 바뀜**. PR 2 는 DART 의 trailing EPS 로 `trailingPER = price / trailingEPS` 를 자체 계산해 `per` 필드에 우선 사용 (없으면 yahoo-finance2 의 forwardPE fallback). 결과적으로 KR 종목은 DART 가능 시 trailing PER, 불가 시 forward PER 표시 — fundamentalsSource 메타로 출처 명시.

## 2. 목표 및 비목표

### 목표
- KR 종목의 PBR + 배당수익률 갭을 DART trailing 재무로 자체 계산해 채움
- KR 종목의 PER 을 trailing 기준으로 회복 (yahoo-finance2 의 forward PER fallback 위에 overlay)
- `value`/`growth` 페르소나가 trailing 매출 성장률·영업이익률·EPS·BPS 같은 정량 근거 사용
- DART 실패 시 yahoo-finance2 의 부분 데이터로 자연 fallback (페르소나는 계속 실행)
- 운영 환경변수 한 줄로 즉시 롤백 가능

### 비목표 (이 PR 영역 아님)
- 미국 종목 (NASDAQ/NYSE) 펀더멘털 — PR 3 의 PlayMCP UsStockInfo 통합 영역
- 외국인/기관 매매동향, 공매도 잔고 — KRX OpenAPI 에 없음, 별도 솔루션 필요
- 실시간 catalyst 뉴스 (growth 페르소나의 "최근 보고서에 따르면..." fabrication) — PR 3+ 의 PlayMCP NaverSearch 영역
- Forward PER, 컨센서스 목표가 — DART 에 없는 데이터, yahoo-finance2 의 forwardPE 로 충분
- Naver Finance 스크래핑 — DART 로 PBR/배당 자체 계산 가능하므로 grey-area 의존성 회피

## 3. 데이터 흐름 (High-level)

```
analyzeStock(symbol="005930.KS")
    │
    ├─ Yahoo (기존, yahoo-finance2 라이브러리)
    │   ├─ fetchYahooQuotes() ........ price, changePct, currency
    │   ├─ fetchYahooFundamentals() .. marketCap, forwardPE (KR), pbr=null, dividendYield=null
    │   └─ fetchYahooDailyOHLC() ..... 1년 일봉
    │
    └─ DART (신규, KR 종목만)
        ├─ getCorpCode() ............. 종목코드 → corp_code (bootstrap JSON, in-memory cache)
        └─ fetchDartFinancials() ..... 매출, 영업이익, EPS, BPS, 주당배당금 (최근 4분기)
            → 자체 계산:
              - trailingPER = price / trailingEPS
              - derivedPBR = price / trailingBPS
              - derivedDividendYield = annualDPS / price
              - revenueGrowthYoY, opMarginPct

Promise.all (DART 는 wrapped .catch) → mergeSnapshot()
    │
    └─ MarketSnapshot 의 필드별 우선순위:
        - marketCap: yahoo 만 (DART 는 시총 제공 안 함)
        - per: DART trailingPER 우선, 없으면 yahoo forwardPE
        - pbr: DART derivedPBR (yahoo 는 항상 null)
        - dividendYield: DART derivedDividendYield (yahoo 는 항상 null)
        - trailingEPS/BPS/revenueGrowthYoY/opMarginPct: DART 전용 신규 필드
        - fundamentalsSource: "yahoo+dart" | "yahoo" | "none"
        │
        └─ 5 페르소나 병렬 호출 (기존 그대로, prompt_version v2 로 cache 무효화)
```

**오류 격리**: DART 실패 시 (corp_code 없음/rate limit/timeout) snapshot 은 yahoo 데이터만으로 진행. PR #119 의 `hasFundamentals` 체크가 value 페르소나 skip 여부를 결정.

## 4. 스키마 변경 (`packages/stock-analysis/src/schemas/consensus.ts`)

```ts
export const MarketSnapshotSchema = z.object({
  // 기존 필드 모두 유지
  price: z.number(),
  changePct: z.number(),
  currency: z.string(),
  marketCap: z.number().optional(),
  per: z.number().optional(),
  pbr: z.number().optional(),
  dividendYield: z.number().optional(),
  debtRatio: z.number().optional(),
  rsi14: z.number().optional(),
  ma20: z.number().optional(),
  ma60: z.number().optional(),
  asOf: z.string(),

  // 신규 — DART trailing 정량 지표
  trailingEPS: z.number().optional(),
  trailingBPS: z.number().optional(),
  revenueGrowthYoY: z.number().optional(),
  opMarginPct: z.number().optional(),

  // 신규 — 데이터 출처 메타
  fundamentalsSource: z.enum(["yahoo+dart", "yahoo", "none"]).optional(),
  fundamentalsAsOf: z.string().optional(),       // ISO 날짜
  dartReportPeriod: z.string().optional(),       // "2025-Q3" / "2025-사업보고서"
});
```

신규 필드 7개, 모두 `.optional()` — v1 cache row JSONB 와 호환.

## 5. 페르소나 프롬프트 변경

대원칙: 4개 페르소나 (wallStreet, krExpert, growth, technical) 는 `JSON.stringify(input.snapshot)` 으로 dump 하므로 신규 필드가 자동 노출 → 프롬프트 변경 불필요.

**value 페르소나만 명시 변경** — DART 의 trailing 지표를 직접 참조:

```ts
// packages/stock-analysis/src/personas/value.ts (추가 라인)
펀더멘털 수치 (제공된 값만 사용):
- PER: ${input.snapshot.per ?? "데이터 없음"}
  (기준: ${input.snapshot.fundamentalsSource === "yahoo+dart" ? "DART trailing" : input.snapshot.fundamentalsSource === "yahoo" ? "Yahoo forward" : "—"})
- PBR: ${input.snapshot.pbr ?? "데이터 없음"} (DART 계산)
- 배당수익률: ${input.snapshot.dividendYield ?? "데이터 없음"}% (DART 계산)
- trailing EPS: ${input.snapshot.trailingEPS ?? "데이터 없음"} 원
- trailing BPS: ${input.snapshot.trailingBPS ?? "데이터 없음"} 원
- 매출 YoY: ${input.snapshot.revenueGrowthYoY ?? "데이터 없음"}%
- 영업이익률: ${input.snapshot.opMarginPct ?? "데이터 없음"}%
- DART 기준 분기: ${input.snapshot.dartReportPeriod ?? "—"}
```

**growth 페르소나 system prompt 한 줄 추가**:
> "매출 YoY 가 제공되면 그 수치를 narrative 의 핵심 근거로 사용. 추정/fabrication 금지."

### prompt_version bump

```ts
// packages/stock-analysis/src/personas/index.ts
export const PERSONA_PROMPT_VERSION = "v2";  // v1 → v2
```

`upsertAnalysis`/`selectAnalysis` 시그니처에 `promptVersion` 추가. v1 cache row 는 매칭 안 됨 → 자동 cache miss → orchestrator 재실행 → v2 결과로 자연 교체.

## 6. 어댑터 상세 — DART (`packages/stock-analysis/src/adapters/dart.ts`)

```ts
const DART_BASE = "https://opendart.fss.or.kr/api";
const TIMEOUT_MS = 8_000;
const CB_FAIL_THRESHOLD = 5;
const CB_COOLDOWN_MS = 30 * 60_000;

interface CircuitState { failures: number; openedAt: number | null; }
const cbState: CircuitState = { failures: 0, openedAt: null };

export interface DartFinancials {
  krxCode: string;
  corpCode: string;
  reportPeriod: string;     // "2025-Q3" 또는 "2025-사업보고서"
  revenueTrailing4Q: number | null;
  revenueGrowthYoY: number | null;     // %
  operatingProfitTrailing4Q: number | null;
  opMarginPct: number | null;          // %
  eps: number | null;                  // trailing EPS (원)
  bps: number | null;                  // 분기말 BPS (원)
  annualDPS: number | null;            // 연간 주당배당금 (원)
  asOf: string;                        // 가장 최근 공시 접수일자
}

export class DartError extends Error {}

export async function fetchDartFinancials(
  krxCode: string,
  authKey: string,
): Promise<DartFinancials>;
```

### 6.1 corp_code 매핑 전략

DART API 는 종목코드가 아닌 8자리 `corp_code` 요구. ZIP 다운로드 + XML 파싱은 runtime 부담 → **bootstrap JSON 정적 commit**.

- `packages/stock-analysis/src/adapters/dart-corp-codes.json` (KRX 약 2,700개, ~250KB)
- 생성 방법: `scripts/build-dart-corp-codes.ts` 1회용 스크립트 — DART `corpCode.xml` ZIP 다운로드 → unzip → XML 파싱 → `{ "<6자리 KRX 코드>": "<8자리 corp_code>" }` JSON 으로 저장. 의존성: Node 내장 `zlib` (gzip) 또는 가벼운 `adm-zip` (~10KB). Phase 1 에서 가장 가벼운 옵션 채택.
- 첫 PR 범위: bootstrap JSON + 생성 스크립트 commit
- weekly 갱신 cron (DB 테이블로 마이그레이션) 은 **별도 후속 PR**

### 6.2 Trailing 4Q 자동 탐지 + 파생 지표 계산

1. 현재 분기에서 거꾸로 reprt_code 4종 (11013=Q1, 11012=반기, 11014=Q3, 11011=사업보고서) 시도
2. status=`013` (no data) 면 직전 분기로 fallback (최대 4분기 거슬러)
3. 최근 4분기 매출/영업이익 합산 → revenueTrailing4Q, operatingProfitTrailing4Q
4. 직전 4Q 합과 비교 → revenueGrowthYoY = `(curr - prev) / prev * 100`
5. opMarginPct = `operatingProfitTrailing4Q / revenueTrailing4Q * 100`
6. EPS: 가장 최근 공시의 `당기순이익 / 의결권주식수` (또는 DART 가 직접 제공하는 `account_nm = "주당순이익"`)
7. BPS: `자본총계 / 의결권주식수` (또는 `account_nm = "주당순자산"`)
8. annualDPS: 최근 사업보고서의 `account_nm = "주당현금배당금"` (분기보고서엔 보통 없음)

### 6.3 에러 케이스

| 케이스 | 동작 |
|---|---|
| corp_code 매핑 없음 (외국법인, 신규 상장 등) | DartError("not_listed_in_dart"), snapshot 은 yahoo 만 |
| 분기 보고서 미공시 | 직전 분기 시도 (최대 4분기 거슬러) |
| status="013" (no data) | null 반환 |
| status="020" (rate limit) | DartError, CB +1 |
| status="010" (key 사용중지) | DartError("key-suspended"), CB 즉시 open |
| Timeout 8초 | DartError, CB +1 |
| 5회 연속 실패 → CB open | 30분 차단, 차단 중 호출은 즉시 throw |
| BPS/EPS 둘 다 null | derivedPBR/trailingPER = undefined (Yahoo forwardPE 사용) |

## 7. Orchestrator 변경 (`apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts`)

PR #119/#120 머지 후의 main 상태 위에 DART 통합 추가. `fetchYahooFundamentals` 호출은 **유지** (제거 안 함).

```ts
import {
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooDailyOHLC,
  fetchDartFinancials,
  PERSONA_PROMPT_VERSION,
  type MarketSnapshot,
  type DartFinancials,
  type NormalizedFundamentals,
} from "@gons/stock-analysis";
import {
  simpleMovingAverage,
  relativeStrengthIndex,
  lastFinite,
} from "@/shared/lib/ta/indicators";
import { env } from "@/shared/config/env";

export async function analyzeStock(args: AnalyzeStockArgs): Promise<AnalyzeStockResult> {
  // DART 는 KR 종목 한정. 미국/암호화폐는 yahoo 만 (PR 3 영역).
  const isKrx = args.symbol.endsWith(".KS") || args.symbol.endsWith(".KQ");
  const krxCode = isKrx ? args.symbol.replace(/\.(KS|KQ)$/, "") : null;
  const enableDart =
    env.STOCK_FUNDAMENTALS_SOURCES !== "off" &&
    krxCode != null &&
    env.DART_OPENAPI_AUTH_KEY != null;

  const [quotes, yahooFund, dailyOHLC, dartResult] = await Promise.all([
    fetchYahooQuotes([args.symbol]),
    fetchYahooFundamentals(args.symbol).catch(() => null),
    fetchYahooDailyOHLC(args.symbol, "1y").catch(() => []),
    enableDart && krxCode
      ? fetchDartFinancials(krxCode, env.DART_OPENAPI_AUTH_KEY!).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (quotes.length === 0) {
    return { status: "failed", personas: {}, consensus: null, marketSnapshot: null };
  }
  const q = quotes[0];
  const closes = dailyOHLC.map((d) => d.close);

  const snapshot = mergeSnapshot(q, yahooFund, dartResult, closes);
  logSnapshotSources(args.symbol, {
    yahoo: !!yahooFund,
    dart: !!dartResult,
    source: snapshot.fundamentalsSource,
  });
  // ... 기존 페르소나/합의/upsert 로직 (promptVersion: PERSONA_PROMPT_VERSION)
}

function mergeSnapshot(
  q: NormalizedQuote,
  yahoo: NormalizedFundamentals | null,
  dart: DartFinancials | null,
  closes: number[],
): MarketSnapshot {
  const price = q.price;

  // DART 우선 (자체 계산), yahoo fallback
  const trailingPER =
    dart?.eps && dart.eps > 0 ? price / dart.eps : undefined;
  const derivedPBR =
    dart?.bps && dart.bps > 0 ? price / dart.bps : undefined;
  const derivedDividendYield =
    dart?.annualDPS && price > 0 ? (dart.annualDPS / price) * 100 : undefined;

  const fundamentalsSource: "yahoo+dart" | "yahoo" | "none" =
    dart != null ? "yahoo+dart" : yahoo != null ? "yahoo" : "none";

  return {
    price,
    changePct: q.changePct,
    currency: q.currency,
    marketCap: yahoo?.marketCap,                       // Yahoo 만
    per: trailingPER ?? yahoo?.per,                    // DART trailing 우선, yahoo forward fallback
    pbr: derivedPBR ?? yahoo?.pbr,                     // DART 우선, yahoo 는 항상 null
    dividendYield: derivedDividendYield ?? yahoo?.dividendYield,
    trailingEPS: dart?.eps ?? undefined,
    trailingBPS: dart?.bps ?? undefined,
    revenueGrowthYoY: dart?.revenueGrowthYoY ?? undefined,
    opMarginPct: dart?.opMarginPct ?? undefined,
    dartReportPeriod: dart?.reportPeriod ?? undefined,
    fundamentalsSource,
    fundamentalsAsOf: dart?.asOf ?? yahoo ? new Date().toISOString().slice(0, 10) : undefined,
    ma20: lastFinite(simpleMovingAverage(closes, 20)),
    ma60: lastFinite(simpleMovingAverage(closes, 60)),
    rsi14: lastFinite(relativeStrengthIndex(closes, 14)),
    asOf: q.fetchedAt,
  };
}
```

**핵심 변경**:
- `fetchYahooFundamentals` 호출 **유지** (제거 X)
- DART 는 KR 종목 + key 있음 + 토글 ON 모두 만족 시에만 호출
- `mergeSnapshot` 함수가 우선순위 머지 (DART 자체 계산 > yahoo > undefined)
- 관측 로그 `logSnapshotSources` — stdout JSON 한 줄 (source 가용성 추적)

## 8. 환경 변수 추가

`.env.example` + `apps/dashboard/src/shared/config/env.ts`:

```bash
# DART OpenAPI (재무제표)
# 발급: opendart.fss.or.kr 회원가입 → 인증키 발급 (1일 소요)
DART_OPENAPI_AUTH_KEY=

# 펀더멘털 소스 토글 (롤백 스위치)
# - "yahoo+dart" (기본): yahoo-finance2 + DART overlay
# - "off": DART 비활성, yahoo-finance2 만 (PR #120 직후 동작)
STOCK_FUNDAMENTALS_SOURCES=yahoo+dart
```

Zod 검증:
- `DART_OPENAPI_AUTH_KEY: z.string().min(1).optional()` — 없으면 DART 어댑터 silent skip (운영 부팅 실패 회피)
- `STOCK_FUNDAMENTALS_SOURCES: z.enum(["yahoo+dart", "off"]).default("yahoo+dart")`

운영 .env 추가 절차:
1. DART 회원가입 → 인증키 발급 (T+1)
2. 운영 `/home/gon/projects/gon/gons-dashboard/.env` 에 `DART_OPENAPI_AUTH_KEY=<발급키>` 추가
3. `STOCK_FUNDAMENTALS_SOURCES=yahoo+dart` 추가 (생략 시 기본값)
4. `docker compose pull app cron && docker compose up -d --force-recreate app cron`

## 9. 테스트 전략

| 레벨 | 위치 | 케이스 |
|---|---|---|
| Unit (DART) | `packages/stock-analysis/tests/dart.test.ts` | reportPeriod 자동 탐지 (Q3 미공시 → 반기 fallback), revenueGrowthYoY 계산, opMarginPct 계산, EPS/BPS 추출, annualDPS 사업보고서 한정 |
| Unit (DART CB) | 위 동일 | 5회 연속 실패 → 6번째 호출 즉시 throw, status="010" 즉시 CB open, 30분 후 half-open |
| Unit (corp_code) | `packages/stock-analysis/tests/dart-corp-codes.test.ts` | bootstrap JSON 의 005930 / 035420 / 000660 매핑 spot check, 누락 종목 → DartError |
| Unit (merge) | `packages/stock-analysis/tests/merge-snapshot.test.ts` 또는 orchestrator 통합 안 | (a) DART trailing EPS 있음 → per = price/eps, (b) DART eps=null → yahoo forwardPE 사용, (c) DART 전체 null → fundamentalsSource="yahoo", (d) yahoo+DART 모두 null → "none" |
| Integration | `apps/dashboard/src/features/stock-analysis-server/api/orchestrator.test.ts` | (a) KR 종목 + DART 성공 → fundamentalsSource="yahoo+dart", PBR/배당 채워짐, (b) KR + DART 실패 → "yahoo", PBR/배당 undefined, (c) 미국 종목 → DART 호출 안 함 |
| Manual smoke | 운영 cron 트리거 후 위젯 | 005930.KS / 035420.KS / 000660.KS 세 종목 PER/PBR/배당 표시 확인 (실제 DART 응답 차이 spot check) |

**fetch 모킹**: Vitest `vi.spyOn(global, 'fetch')` + fixture JSON (`tests/fixtures/dart-005930-Q3.json`, `dart-005930-사업보고서.json` 2종 1회 수동 캡처).

## 10. 리스크 + 완화

| 리스크 | 가능성 | 완화 |
|---|---|---|
| DART corp_code bootstrap JSON 누락 종목 | 低 | KRX 신규 상장 시 DART 등록까지 1-2주 지연 정상. 누락 종목은 yahoo 만으로 페르소나 진행 |
| DART rate limit (일 20,000건) | 低 | 단일 사용자 < 100종목 × 1일 2회 = 200건 << limit |
| 신규 .env 키 누락으로 운영 부팅 실패 | 中 | `DART_OPENAPI_AUTH_KEY` 를 Zod `optional` 로 — 키 없으면 DART 어댑터만 silent skip |
| schema drift — v1 cache row 가 새 필드 없이 표시 | 低 | prompt_version v2 bump → 즉시 재분석. 첫 사용자가 약 30초 지연 후 정상 표시 |
| DART 계산 PER/PBR 이 시장 (네이버 화면) 과 약간 다를 수 있음 | 中 | annualization 방식 (trailing 4Q sum vs annualized) 차이로 ±5% 오차 가능. value 페르소나 프롬프트에 "DART trailing 기준" 명시로 사용자 혼란 방지 |
| EPS = 0 또는 음수 (적자 기업) → PER 무한대/음수 | 中 | `dart.eps > 0` 가드. 적자 종목은 yahoo forwardPE 사용 (보통 미래 흑자 가정으로 양수) |
| DART 보고서 공시 지연 (Q1 → 5월 중순, Q3 → 11월 중순 등) | 中 | reportPeriod 메타 노출로 페르소나가 "이 PER 은 X분기 기준" 명시. 가장 최근 가능 분기를 자동 선택 |

## 11. 롤백 전략

운영 .env 한 줄 변경 + 컨테이너 재기동 = 즉시 PR #120 직후 동작 복귀:

```bash
# /home/gon/projects/gon/gons-dashboard/.env
STOCK_FUNDAMENTALS_SOURCES=off
```

```bash
docker --context home-server compose -f $COMPOSE up -d --force-recreate app
```

PR revert 불필요 — schema 는 모두 optional 이라 v2 cache row 가 남아있어도 v1 코드와 호환.

## 12. 구현 순서 (Phase 분해)

| Phase | 내용 | 검증 |
|---|---|---|
| 1 | `scripts/build-dart-corp-codes.ts` 1회용 스크립트 작성 + 실행 → `dart-corp-codes.json` commit | KRX Top 종목 (005930, 035420, 000660 등 10개) 매핑 spot check |
| 2 | `dart.ts` 어댑터 — corp_code lookup, reportPeriod 자동 탐지, trailing 4Q 계산, CB | unit test 8개 통과 |
| 3 | `MarketSnapshotSchema` 확장 + `PERSONA_PROMPT_VERSION="v2"` + `mergeSnapshot` 헬퍼 추출 | unit test 4개 통과, 기존 테스트 회귀 없음 |
| 4 | `value.ts` 프롬프트 변경 + `growth.ts` system 한 줄 추가 | persona test 통과 |
| 5 | orchestrator 통합 + DART 병렬 호출 + `logSnapshotSources` | integration test 3 시나리오 통과 |
| 6 | env.ts: `DART_OPENAPI_AUTH_KEY` (optional), `STOCK_FUNDAMENTALS_SOURCES` (default "yahoo+dart"), `.env.example` 업데이트 | dev 부팅 확인 |
| 7 | `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm test && pnpm build` | 모두 green (Gotcha #7 features barrel seam 회피) |
| 8 | PR 생성 + 머지 후 운영 .env DART 키 추가 + compose pull/up | 005930/000660/035420 위젯 표시 검증 — PBR/배당이 "—" 에서 숫자로 |

## 13. Out of Scope (별도 후속 PR)

- 미국 종목 펀더멘털 (PR 3 — PlayMCP UsStockInfo)
- DART corp_code weekly 갱신 cron (별도 PR)
- 외국인/기관 매매동향, 공매도 잔고 (KRX OpenAPI 외 별도 솔루션 조사 필요)
- 실시간 catalyst 뉴스 (PR 3+ — PlayMCP NaverSearch in-process 통합)
- Forward PER 정확도 개선 (DART 가 제공하지 않는 영역)
- KRX OpenAPI `stk_bydd_trd` orchestrator 통합 (Yahoo 일봉과 중복 비교 필요)
- 적자 기업 PER 대체 지표 (EV/EBITDA, P/S 등) — DART 로 계산 가능하나 별도 spec
