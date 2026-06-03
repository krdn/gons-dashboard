# Stock daily OHLC 회복력 보강 — 캐싱 + chart retry 설계

- 날짜: 2026-06-03
- 상태: 설계 승인됨, 구현 대기
- 관련: 2026-06-03 진단 — `fetchYahooDailyOHLC` 콘솔 에러(일시적 transient 실패, graceful degrade 확인)

## 배경

`StockAnalysisCard`는 `force-dynamic` RSC라 매 렌더마다 보유 종목 수만큼
`fetchYahooDailyOHLC(symbol, "1y")`를 **캐시·retry 없이 동시에** Yahoo로 호출한다.
일봉(1y)은 하루 한 번만 의미 있게 바뀌는데, 매 페이지 로드마다 새로 받아온다.

진단 세션(2026-06-03)에서 실제 실패는 재현되지 않았고(보유 3종목 모두 243 rows 성공),
함수 내부 `try/catch`가 `[]`를 반환해 위젯은 빈 차트로 graceful degrade한다.
콘솔에 찍힌 stack은 uncaught가 아니라 라이브러리/Next의 fetch 실패 로깅 노이즈다.
즉 현재는 저심각도지만, 부하 순간 일시적 실패 확률을 낮추는 **구조적 보강**이 목표다.

기존 quote crumb/429 버그(commit `90bccf6`, `cache:no-store`)와는 다른 케이스다 —
에러 URL에 crumb 파라미터가 없고, `getYahooClient`에는 `cache:no-store`가 이미 적용돼 있다.

## 목표

1. **daily OHLC 캐싱** — 같은 일봉을 매 렌더마다 재요청하지 않는다. Yahoo 호출 빈도를 크게 줄여
   rate-limit/일시 실패 노출을 줄인다.
2. **chart retry** — 일시적 실패(429/네트워크 hiccup)를 짧은 backoff로 흡수한다.

비목표: quote/fundamentals 캐싱, DART 캐싱, 새 외부 retry 라이브러리 도입.

## 아키텍처

두 개의 독립적 보강을 서로 다른 레이어에 둔다 (의존성 방향 준수:
`packages/stock-analysis`는 Node-only 라이브러리라 dashboard/Redis에 의존 불가).

```
StockAnalysisCard ─┐
                   ├─→ getCachedDailyOHLC (신규, dashboard/features) ─→ Redis hit? → 반환
orchestrator ──────┘                                                  │
                                                                      └─ miss → fetchYahooDailyOHLC (retry 내장, packages) → Yahoo
```

- **retry**: `packages/stock-analysis` 어댑터 내부 → 모든 호출처가 혜택.
- **캐싱**: `apps/dashboard/features/stock-analysis-server` → Redis(`getRedisClient`) 재사용.

## 컴포넌트 1: chart retry (packages/stock-analysis/src/adapters/yahoo.ts)

`fetchYahooDailyOHLC` 내부 `yf.chart()` 호출을 같은 파일의 작은 로컬 retry 헬퍼로 감싼다.

- **정책**: 최대 2회 재시도(총 3회 시도), backoff 300ms → 600ms (exponential) + jitter(0~100ms).
- 모든 시도 실패 시 기존처럼 `[]` 반환 (graceful degrade 유지) — 함수 시그니처·반환 타입 불변.
- 외부 의존성 추가 없음 — Promise 기반 delay 래퍼 사용.
- retry 대상은 모든 throw (yahoo-finance2 에러 shape를 신뢰하지 않으므로 status별 분기 안 함 —
  진단에서 에러 shape를 확정하지 못했고, 일봉 fetch는 멱등이라 전체 재시도가 안전).

의사 코드:

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const base = 300 * 2 ** i; // 300, 600
        const jitter = Math.floor(Math.random() * 100);
        await delay(base + jitter);
      }
    }
  }
  throw lastErr;
}
```

`fetchYahooDailyOHLC`의 `try` 안에서 `await withRetry(() => yf.chart(symbol, {...}))`로 호출.
바깥 `catch {}`는 그대로 — 최종 실패 시 `[]`.

테스트 가능성을 위해 backoff base는 모듈 상수로 빼서 테스트에서 0으로 override 가능하게 한다.

## 컴포넌트 2: daily OHLC 캐싱 (dashboard)

**신규 파일**: `apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.ts`

```ts
import "server-only";
import { fetchYahooDailyOHLC } from "@gons/stock-analysis";
import { getRedisClient } from "@/shared/lib/redis/client";

type DailyOHLC = Array<{ date: string; close: number; volume: number }>;
type Range = "1mo" | "3mo" | "6mo" | "1y" | "5y";

const TTL_SECONDS = 6 * 60 * 60; // 6h

export async function getCachedDailyOHLC(
  symbol: string,
  range: Range = "1y",
): Promise<DailyOHLC> {
  const key = `stock:ohlc:${symbol}:${range}`;
  const redis = getRedisClient();

  // 1. 캐시 조회 — Redis 실패는 fail-open (직접 fetch로 진행)
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as DailyOHLC;
  } catch {
    // Redis down → 직접 fetch로 폴백
  }

  // 2. miss → fetch (retry 내장)
  const data = await fetchYahooDailyOHLC(symbol, range);

  // 3. 비어있지 않을 때만 캐싱 — 실패(빈 배열) 캐싱 금지(빈 차트 6h 고착 방지)
  if (data.length > 0) {
    try {
      await redis.set(key, JSON.stringify(data), "EX", TTL_SECONDS);
    } catch {
      // 캐시 write 실패는 best-effort — 데이터는 이미 있으니 무시
    }
  }
  return data;
}
```

**호출처 교체** (2곳):

- `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx:52`
  `fetchYahooDailyOHLC(s, "1y")` → `getCachedDailyOHLC(s, "1y")`
- `apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts:94`
  `fetchYahooDailyOHLC(args.symbol, "1y").catch(() => [])` → `getCachedDailyOHLC(args.symbol, "1y").catch(() => [])`
  (orchestrator의 바깥 `.catch(() => [])`는 유지 — fail-safe 이중 방어)

**barrel export**: `features/stock-analysis-server`가 server.ts/client.ts seam을 쓴다면(Gotcha #7),
`getCachedDailyOHLC`는 server-only 함수이므로 server entrypoint(`index.ts`)에서 export.
StockAnalysisCard는 이미 `"server-only"` 컴포넌트라 server entrypoint import 가능.

### 키·TTL 설계 근거

- 키 `stock:ohlc:{symbol}:{range}` — symbol+range별 분리. 글로벌 캐시(holder 무관, OHLC는 사용자 공통).
- TTL 6h — 일 2회 cron 분석 주기와 정합. 장중 당일봉이 약간 stale해도 차트 추세/MA 계산엔 무해.

## 에러 처리

| 상황 | 동작 |
|------|------|
| chart 1~2회 실패 후 성공 | retry로 정상 반환 |
| chart 3회 모두 실패 | `[]` 반환 (빈 차트, graceful degrade) — 캐싱 안 함 |
| Redis 조회 실패 (다운) | catch → 직접 fetch (fail-open) |
| Redis write 실패 | 무시 (best-effort), 데이터는 정상 반환 |

## 테스트

- **packages**: `packages/stock-analysis/tests/yahoo.test.ts`에 retry 테스트 추가.
  `yf.chart` mock — (a) 1회 throw 후 성공 → rows 반환, (b) 3회 throw → `[]`.
  backoff base 상수를 0으로 override해 테스트 속도 확보.
- **dashboard**: `cached-daily-ohlc.ts` unit 테스트 — `getRedisClient` mock으로
  hit/miss/empty-skip(빈 배열 캐싱 안 함)/fail-open(Redis throw 시 직접 fetch) 4 케이스.
- **검증**: `pnpm typecheck && pnpm lint`, packages·dashboard 테스트, 그리고
  `cd apps/dashboard && pnpm build` (Gotcha #7 server/client seam 회귀 방지) PR 전 1회 필수.

## 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `packages/stock-analysis/src/adapters/yahoo.ts` | retry 헬퍼 + `fetchYahooDailyOHLC` 적용 |
| `packages/stock-analysis/tests/yahoo.test.ts` | retry 테스트 추가 |
| `apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.ts` | 신규 — 캐시 래퍼 |
| `apps/dashboard/src/features/stock-analysis-server/index.ts` | `getCachedDailyOHLC` export |
| `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx` | 호출 교체 |
| `apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts` | 호출 교체 |
| (신규) cached-daily-ohlc 테스트 | 캐시 로직 unit 테스트 |
