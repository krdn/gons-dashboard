# Stock daily OHLC 회복력 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** daily OHLC 조회에 chart retry(packages)와 Redis 캐싱(dashboard)을 더해 일시적 Yahoo 실패 노출을 줄인다.

**Architecture:** retry는 `packages/stock-analysis` 어댑터 내부에 두어 모든 호출처가 혜택을 보고, 캐싱은 의존성 방향상 dashboard `features/stock-analysis-server`에서 `getRedisClient`를 재사용해 래핑한다. 두 보강은 독립적이며 각각 graceful degrade(실패 시 `[]`)와 fail-open(Redis 다운 시 직접 fetch)을 유지한다.

**Tech Stack:** TypeScript, yahoo-finance2 v3, ioredis, Vitest (vi.spyOn / vi.mock).

설계 문서: `docs/superpowers/specs/2026-06-03-stock-daily-ohlc-resilience-design.md`

---

## File Structure

| 파일 | 책임 |
|------|------|
| `packages/stock-analysis/src/adapters/yahoo.ts` | `withRetry` 헬퍼 + `fetchYahooDailyOHLC`의 `yf.chart()` 호출 래핑 |
| `packages/stock-analysis/tests/yahoo.test.ts` | retry 동작 테스트 추가 (성공-후-재시도 / 전부-실패) |
| `apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.ts` | 신규 — Redis 6h TTL 캐시 래퍼 `getCachedDailyOHLC` |
| `apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.test.ts` | 신규 — hit/miss/empty-skip/fail-open unit 테스트 |
| `apps/dashboard/src/features/stock-analysis-server/index.ts` | `getCachedDailyOHLC` re-export (server entrypoint) |
| `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx` | 호출 교체 (line 14 import, line 52 call) |
| `apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts` | 호출 교체 (line 22 import, line 94 call) |

---

## Task 1: chart retry 헬퍼 + fetchYahooDailyOHLC 적용

**Files:**
- Modify: `packages/stock-analysis/src/adapters/yahoo.ts` (헬퍼 추가 + line 126-141 본문)
- Test: `packages/stock-analysis/tests/yahoo.test.ts` (describe "fetchYahooDailyOHLC"에 추가)

- [ ] **Step 1: retry 테스트 2개를 작성 (실패 예상)**

`packages/stock-analysis/tests/yahoo.test.ts`의 `describe("fetchYahooDailyOHLC", ...)` 블록 안,
기존 `it("chart() 응답을 close > 0 만 normalize", ...)` 다음에 추가:

```ts
  it("chart() 가 1회 실패 후 성공하면 retry 로 결과 반환", async () => {
    const yf = getYahooClient();
    let calls = 0;
    vi.spyOn(yf, "chart").mockImplementation((async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient 429");
      return {
        quotes: [
          { date: new Date("2026-04-01"), close: 180.0, volume: 50_000_000 },
        ],
      };
    }) as unknown as typeof yf.chart);
    const r = await fetchYahooDailyOHLC("AAPL", "1mo");
    expect(calls).toBe(2);
    expect(r).toEqual([{ date: "2026-04-01", close: 180.0, volume: 50_000_000 }]);
  });

  it("chart() 가 3회 모두 실패하면 [] 반환 (graceful degrade)", async () => {
    const yf = getYahooClient();
    const spy = vi
      .spyOn(yf, "chart")
      .mockRejectedValue(new Error("persistent failure"));
    const r = await fetchYahooDailyOHLC("AAPL", "1mo");
    expect(r).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(3);
  });
```

테스트 속도를 위해 backoff base 를 0 으로 만들 환경 훅이 필요하다 — Step 3 에서 상수를
환경변수로 override 가능하게 한다. 테스트 파일 최상단(import 직후)에 추가:

```ts
// retry backoff 를 0 으로 — 테스트가 실제 setTimeout 지연을 기다리지 않도록.
process.env.STOCK_RETRY_BACKOFF_MS = "0";
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd packages/stock-analysis && npx vitest run tests/yahoo.test.ts -t "retry"`
Expected: FAIL — 현재는 1회 실패 시 즉시 `[]` 반환하므로 `calls` 가 1, 결과가 `[]` → 단언 불일치.

- [ ] **Step 3: withRetry 헬퍼 추가 + fetchYahooDailyOHLC 적용**

`packages/stock-analysis/src/adapters/yahoo.ts` 의 `fetchYahooDailyOHLC` 함수 **위**에
헬퍼와 상수를 추가:

```ts
// chart() 등 일시적 실패(429/네트워크 hiccup)를 짧은 backoff 로 흡수.
// 일봉 fetch 는 멱등이라 status 분기 없이 모든 throw 를 재시도한다.
// backoff base 는 테스트에서 STOCK_RETRY_BACKOFF_MS=0 으로 무력화 가능.
function retryBackoffMs(): number {
  const raw = process.env.STOCK_RETRY_BACKOFF_MS;
  const parsed = raw != null ? Number(raw) : 300;
  return Number.isFinite(parsed) ? parsed : 300;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const base = retryBackoffMs() * 2 ** i; // 300, 600 (기본)
        const jitter = base > 0 ? Math.floor(Math.random() * 100) : 0;
        await delay(base + jitter);
      }
    }
  }
  throw lastErr;
}
```

그리고 `fetchYahooDailyOHLC` 의 `try` 블록 안 `yf.chart(...)` 호출을 `withRetry` 로 감싼다.
기존 (line 126-131):

```ts
  try {
    const result = (await yf.chart(symbol, {
      period1: start,
      period2: now,
      interval: "1d",
    })) as ChartResultArray;
```

변경 후:

```ts
  try {
    const result = (await withRetry(() =>
      yf.chart(symbol, {
        period1: start,
        period2: now,
        interval: "1d",
      }),
    )) as ChartResultArray;
```

바깥 `catch { return []; }` 는 그대로 둔다 — withRetry 가 최종 throw 하면 여기서 `[]`.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd packages/stock-analysis && npx vitest run tests/yahoo.test.ts`
Expected: PASS — retry 2개 + 기존 normalize 테스트 모두 통과.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/src/adapters/yahoo.ts packages/stock-analysis/tests/yahoo.test.ts
git commit -m "feat(stock): fetchYahooDailyOHLC 에 chart retry-backoff 추가

- 최대 2회 재시도(총 3회), 300→600ms backoff + jitter
- 일시적 429/네트워크 hiccup 흡수, 최종 실패는 기존대로 [] 반환
- STOCK_RETRY_BACKOFF_MS 로 테스트에서 backoff 무력화

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: getCachedDailyOHLC 캐시 래퍼 + 테스트

**Files:**
- Create: `apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.ts`
- Test: `apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.test.ts`

- [ ] **Step 1: 캐시 로직 테스트 작성 (실패 예상)**

`apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.test.ts` 생성:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockFetch = vi.fn();

vi.mock("@/shared/lib/redis/client", () => ({
  getRedisClient: () => ({ get: mockGet, set: mockSet }),
}));

vi.mock("@gons/stock-analysis", () => ({
  fetchYahooDailyOHLC: mockFetch,
}));

// mock 선언 후 import (hoist 안전).
import { getCachedDailyOHLC } from "./cached-daily-ohlc";

const SAMPLE = [{ date: "2026-04-01", close: 180, volume: 50_000_000 }];

beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockReset();
  mockFetch.mockReset();
  mockSet.mockResolvedValue("OK");
});

describe("getCachedDailyOHLC", () => {
  it("캐시 hit 시 fetch 안 하고 파싱된 값 반환", async () => {
    mockGet.mockResolvedValue(JSON.stringify(SAMPLE));
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual(SAMPLE);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("캐시 miss 시 fetch 후 6h TTL 로 저장", async () => {
    mockGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue(SAMPLE);
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual(SAMPLE);
    expect(mockFetch).toHaveBeenCalledWith("AAPL", "1y");
    expect(mockSet).toHaveBeenCalledWith(
      "stock:ohlc:AAPL:1y",
      JSON.stringify(SAMPLE),
      "EX",
      21600,
    );
  });

  it("빈 배열은 캐싱하지 않는다 (실패 고착 방지)", async () => {
    mockGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue([]);
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual([]);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("Redis get 실패 시 직접 fetch (fail-open)", async () => {
    mockGet.mockRejectedValue(new Error("redis down"));
    mockFetch.mockResolvedValue(SAMPLE);
    const r = await getCachedDailyOHLC("AAPL", "1y");
    expect(r).toEqual(SAMPLE);
    expect(mockFetch).toHaveBeenCalledWith("AAPL", "1y");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/dashboard && npx vitest run src/features/stock-analysis-server/api/cached-daily-ohlc.test.ts`
Expected: FAIL — `./cached-daily-ohlc` 모듈/`getCachedDailyOHLC` export 없음.

- [ ] **Step 3: 캐시 래퍼 구현**

`apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.ts` 생성:

```ts
// daily OHLC Redis 캐시 래퍼 — 일봉은 하루 1회만 의미 있게 바뀌므로 6h TTL 로 캐싱해
// 매 RSC 렌더마다의 Yahoo 호출을 줄인다. retry 는 packages 어댑터 내부에 있다.
//
// 정책:
//  - hit → JSON 파싱 반환 (fetch skip)
//  - miss → fetchYahooDailyOHLC (retry 내장) → 비어있지 않으면 6h TTL 로 SET
//  - 빈 배열(실패)은 캐싱 안 함 — 빈 차트가 6h 고착되는 것 방지
//  - Redis 다운(get/set throw) 은 fail-open / best-effort — 데이터 흐름을 막지 않음
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

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as DailyOHLC;
  } catch {
    // Redis down → 직접 fetch 로 폴백 (fail-open)
  }

  const data = await fetchYahooDailyOHLC(symbol, range);

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

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd apps/dashboard && npx vitest run src/features/stock-analysis-server/api/cached-daily-ohlc.test.ts`
Expected: PASS — 4 케이스 모두 통과.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.ts apps/dashboard/src/features/stock-analysis-server/api/cached-daily-ohlc.test.ts
git commit -m "feat(stock): getCachedDailyOHLC — daily OHLC Redis 6h 캐시 래퍼

- hit/miss/empty-skip/fail-open 정책
- 빈 배열은 캐싱 안 함, Redis 다운 시 직접 fetch

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: barrel export + 호출처 2곳 교체

**Files:**
- Modify: `apps/dashboard/src/features/stock-analysis-server/index.ts`
- Modify: `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx` (line 12-16 import, line 52 call)
- Modify: `apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts` (line 20-28 import, line 94 call)

- [ ] **Step 1: server entrypoint 에 export 추가**

`apps/dashboard/src/features/stock-analysis-server/index.ts` 의 `triggerAnalysis` export 아래에 추가:

```ts
export { getCachedDailyOHLC } from "./api/cached-daily-ohlc";
```

- [ ] **Step 2: StockAnalysisCard 호출 교체**

`apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx`:

import 블록 (line 12-16) 에서 `fetchYahooDailyOHLC` 를 제거하고 `getCachedDailyOHLC` 를
`@/features/stock-analysis-server` 에서 가져온다. 변경 전:

```ts
import {
  fetchYahooQuotes,
  fetchYahooDailyOHLC,
  PERSONA_PROMPT_VERSION,
} from "@gons/stock-analysis";
```

변경 후:

```ts
import { fetchYahooQuotes, PERSONA_PROMPT_VERSION } from "@gons/stock-analysis";
import { getCachedDailyOHLC } from "@/features/stock-analysis-server";
```

그리고 line 51-53 의 호출:

```ts
    Promise.all(
      symbols.map((s) => fetchYahooDailyOHLC(s, "1y")),
    ),
```

변경 후:

```ts
    Promise.all(
      symbols.map((s) => getCachedDailyOHLC(s, "1y")),
    ),
```

> **정정 (final 리뷰 후):** 아래 Step 3의 orchestrator 교체는 **실행하지 않았다.** final 통합 리뷰에서 orchestrator의 `dailyOHLC`가 flip 감지·web-push·canonical DB upsert에 쓰여 장중 미정산 봉 캐시가 EOD 분석을 오염시키고, cron은 하루 2회라 캐시 이득도 0임을 발견. retry는 `fetchYahooDailyOHLC` 내부에 있어 캐시 우회해도 유지되므로 orchestrator는 fresh fetch 그대로 둔다. **캐시는 StockAnalysisCard(Step 2)에만 적용.** (커밋 `1ef513b` 참조)

- [ ] **Step 3: orchestrator 호출 교체 — ⚠️ 적용 안 함 (위 정정 참조)**

`apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts`:

import (line 20-28 의 `@gons/stock-analysis` 블록) 에서 `fetchYahooDailyOHLC,` 줄을 제거한다.
변경 전 (line 22):

```ts
  fetchYahooDailyOHLC,
```

→ 이 줄 삭제. orchestrator.ts 와 cached-daily-ohlc.ts 는 둘 다 `api/` 디렉토리 안이므로
상대경로는 `"./cached-daily-ohlc"`. import 블록 끝(예: `import { callLlmAndParseWithRetry } from "./llm-call";` 아래)에 추가:

```ts
import { getCachedDailyOHLC } from "./cached-daily-ohlc";
```

그리고 line 94 의 호출:

```ts
    fetchYahooDailyOHLC(args.symbol, "1y").catch(() => []),
```

변경 후 (바깥 catch 유지 — 이중 방어):

```ts
    getCachedDailyOHLC(args.symbol, "1y").catch(() => []),
```

- [ ] **Step 4: typecheck + lint**

Run: `cd /home/gon/projects/gon/gons-dashboard && pnpm typecheck && pnpm lint`
Expected: PASS — 에러 없음. (`fetchYahooDailyOHLC` 미사용 import 가 남아있으면 lint 에서 잡힘 → 제거 확인.)

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/stock-analysis-server/index.ts apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts
git commit -m "feat(stock): StockAnalysisCard·orchestrator 를 getCachedDailyOHLC 로 교체

- 직접 fetchYahooDailyOHLC 대신 Redis 캐시 래퍼 사용
- orchestrator 의 바깥 .catch(() => []) 는 이중 방어로 유지

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 전체 검증 (typecheck / lint / test / build)

**Files:** (검증만, 변경 없음)

- [ ] **Step 1: packages 테스트**

Run: `cd packages/stock-analysis && npx vitest run`
Expected: PASS — retry 포함 전체 통과.

- [ ] **Step 2: dashboard 캐시 테스트**

Run: `cd apps/dashboard && npx vitest run src/features/stock-analysis-server/api/cached-daily-ohlc.test.ts`
Expected: PASS.

- [ ] **Step 3: typecheck + lint (FSD boundary 포함)**

Run: `cd /home/gon/projects/gon/gons-dashboard && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: production build (Gotcha #7 server/client seam 회귀 방지 — 필수)**

Run: `cd apps/dashboard && pnpm build`
Expected: PASS — `Module not found: tls/net/perf_hooks` 같은 server-only 누출 에러 없음.
(StockAnalysisCard 가 `getCachedDailyOHLC` 를 server entrypoint 에서 import 하므로 client tree 누출 없어야 함.)

- [ ] **Step 5: (선택) 통합 테스트 — 로컬 DB 있을 때만**

Run: `cd /home/gon/projects/gon/gons-dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: pure unit 통과. DB 미기동 시 통합 테스트는 ECONNREFUSED — 정상 (Gotcha #2).

---

## Self-Review 결과

- **Spec coverage:** 컴포넌트1(retry)=Task1, 컴포넌트2(캐싱)=Task2+3, 에러 처리 표=Task2 테스트 4케이스 + Task1 graceful degrade, 테스트 섹션=Task1·2 + Task4 build. 모든 spec 섹션이 task 에 매핑됨.
- **Placeholder scan:** 모든 코드 step 에 실제 코드 블록 포함. TODO/TBD 없음.
- **Type consistency:** `getCachedDailyOHLC(symbol, range)` 시그니처가 Task2 정의·Task3 호출·테스트에서 일치. 키 형식 `stock:ohlc:{symbol}:{range}`, TTL `21600`(=6×60×60) 일관. `DailyOHLC` 타입이 기존 `{date,close,volume}` 와 일치.
- **경로 확정:** Task3 Step3 의 orchestrator import 상대경로는 `./cached-daily-ohlc` (둘 다 `api/` 안).
