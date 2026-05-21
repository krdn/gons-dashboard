# Phase 7: Cron + Flip Push

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** 등록된 포트폴리오 종목을 자산군별 cron 으로 일괄 재분석 → 어제 합의 vs 오늘 합의 비교 → `BUY ↔ HOLD ↔ SELL` flip 시 `stock_consensus_flips` INSERT + web-push 발송. spec §2 (cron 라우팅) + §7 (P7) + §2.1 #4 (flip 알림).

**완료 조건:**
- `/api/cron/stock-analyze` POST 라우트 (Bearer 인증, `?market=KR|US_GLOBAL` 쿼리)
- `createCronHandler` 셰이프 + `fanOut` concurrency 2 (LLM rate-limit 회피)
- 자산군 라우팅: `KR` = `market='KR'`, `US_GLOBAL` = `market IN ('US','CRYPTO','COMMODITY')`
- `detectConsensusFlip(yesterday, today)` 함수 — `prompt_version` 일치 + `from_verdict !== to_verdict` 만
- `stock_consensus_flips` row INSERT (24h 1회 cap 은 partial unique index 로 차단)
- web-push 발송 + `notifiedAt` 갱신 (재발송 차단)
- `apps/cron/scheduler.js` 에 KST 16:30 (KR) + 06:30 (US_GLOBAL) 두 스케줄 등록
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` PASS

**전제:**
- Phase 6 PR #111 머지 + 운영 0023/0024 마이그레이션 적용 완료
- `stock_consensus_flips` 테이블 운영 DB 에 존재 (Phase 1, `flips_pending_idx` partial index)
- `push_subscriptions` 테이블 + `shared/lib/push/index.ts` (`sendPush`) 동작
- `analyzeStock(args)` orchestrator (Phase 3 T3.5) + `stockAnalysisCache` (글로벌 캐시 24h TTL) 동작

⚠️ **24h 1회 cap 결정**: spec §2.1 #4. 같은 `(user_id, symbol)` 의 같은 날(`detected_at::date`) flip 은 한 번만 알림. partial unique index 추가 (Task 7.1 — `stock_consensus_flips` 에 `flips_dedup_uq`).

⚠️ **prompt_version 불일치 처리**: 어제 cache 가 `v=1` 인데 오늘 `v=2` 면 flip 판정 무의미 — `detectConsensusFlip` 이 두 캐시의 `promptVersion` 비교해 다르면 skip.

⚠️ **글로벌 vs user-specific 캐시**: spec §2.1 #1 — 같은 종목은 한 번만 분석 (cache `user_id=NULL`). flip 판정은 **포트폴리오를 가진 모든 user** 에 대해 stock_consensus_flips INSERT (user_id 별 row). web-push 도 user 별 subscriptions 으로 보냄.

---

## Task 7.1: stock_consensus_flips 24h dedup index

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` (stockConsensusFlips 정의)
- Generated: `apps/dashboard/drizzle/00XX_*.sql`

기존 schema 의 `stockConsensusFlips` 에 partial unique index 추가 — 같은 (user, symbol) 의 같은 날 detection 단 1회. flip 이 cron 안에서 idempotent.

- [ ] **Step 1: schema.ts 갱신**

기존:
```ts
(t) => [
  index("flips_pending_idx").on(t.notifiedAt).where(sql`${t.notifiedAt} IS NULL`),
],
```

→
```ts
(t) => [
  index("flips_pending_idx").on(t.notifiedAt).where(sql`${t.notifiedAt} IS NULL`),
  // 24h 1회 cap (spec §2.1 #4) — 같은 (user, symbol) 의 같은 날짜 detection 단 1회.
  // INSERT 시 unique violation 발생하면 cron 이 catch + skip (이미 알림 보냄).
  uniqueIndex("flips_dedup_uq")
    .on(t.userId, t.symbol, sql`(${t.detectedAt}::date)`),
],
```

- [ ] **Step 2: drizzle-kit generate**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm db:generate
```

⚠️ snapshot collision 시 메모리 `drizzle-snapshot-id-collision` 참조.

- [ ] **Step 3: typecheck + commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
pnpm --filter @gons/dashboard typecheck
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(stock-analysis): stock_consensus_flips 에 24h dedup unique index 추가"
```

---

## Task 7.2: detectConsensusFlip 함수

**Files:**
- Create: `apps/dashboard/src/features/stock-push-flip/api/detect.ts`
- Create: `apps/dashboard/src/features/stock-push-flip/index.ts` (server barrel)

캐시에서 어제 row + 오늘 row 끌어와 verdict 비교. prompt_version 다르면 skip.

- [ ] **Step 1: api/detect.ts**

```ts
import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockAnalysisCache } from "@/shared/lib/db/schema";
import type { Consensus } from "@gons/stock-analysis";

export type Verdict = "BUY" | "HOLD" | "SELL";

export interface FlipDetection {
  symbol: string;
  fromVerdict: Verdict;
  toVerdict: Verdict;
}

/**
 * 어제 vs 오늘 글로벌 캐시 비교.
 * - 둘 다 user_id IS NULL (글로벌 캐시) 행 사용
 * - promptVersion 다르면 null 반환 (비교 무의미)
 * - verdict 동일하면 null
 */
export async function detectConsensusFlip(args: {
  symbol: string;
  yesterdayDate: string; // 'YYYY-MM-DD'
  todayDate: string;
}): Promise<FlipDetection | null> {
  const rows = await db
    .select({
      analysisDate: stockAnalysisCache.analysisDate,
      consensus: stockAnalysisCache.consensus,
      promptVersion: stockAnalysisCache.promptVersion,
    })
    .from(stockAnalysisCache)
    .where(
      and(
        eq(stockAnalysisCache.symbol, args.symbol),
        isNull(stockAnalysisCache.userId), // 글로벌 캐시
      ),
    );

  const todayRow = rows.find((r) => String(r.analysisDate) === args.todayDate);
  const yesterdayRow = rows.find(
    (r) => String(r.analysisDate) === args.yesterdayDate,
  );

  if (!todayRow || !yesterdayRow) return null;
  if (todayRow.promptVersion !== yesterdayRow.promptVersion) return null;

  const todayVerdict = (todayRow.consensus as Consensus).verdict;
  const yesterdayVerdict = (yesterdayRow.consensus as Consensus).verdict;

  if (todayVerdict === yesterdayVerdict) return null;

  return {
    symbol: args.symbol,
    fromVerdict: yesterdayVerdict,
    toVerdict: todayVerdict,
  };
}
```

⚠️ `Consensus` 타입은 `@gons/stock-analysis` (packages/stock-analysis) 에서 export. import 가능한지 Task 0 에서 grep 확인.

- [ ] **Step 2: features/stock-push-flip/index.ts (server barrel)**

```ts
import "server-only";

export { detectConsensusFlip } from "./api/detect";
export type { FlipDetection, Verdict } from "./api/detect";
export { notifyFlip } from "./api/notify"; // Task 7.3 에서 추가
export type { NotifyResult } from "./api/notify";
```

- [ ] **Step 3: typecheck + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/stock-push-flip/
git commit -m "feat(stock-analysis): detectConsensusFlip — 어제/오늘 글로벌 캐시 비교 (prompt_version 일치 시만)"
```

---

## Task 7.3: notifyFlip — flip INSERT + web-push

**Files:**
- Create: `apps/dashboard/src/features/stock-push-flip/api/notify.ts`

`stock_consensus_flips` row INSERT (unique violation catch) + user 의 push subscriptions 전체에 발송 + `notifiedAt` UPDATE.

- [ ] **Step 1: api/notify.ts**

```ts
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockConsensusFlips,
  pushSubscriptions,
} from "@/shared/lib/db/schema";
import { sendPush } from "@/shared/lib/push";
import type { FlipDetection } from "./detect";

const FLIP_TITLE: Record<string, string> = {
  "BUY→HOLD": "합의 전환: 매수 → 보유",
  "BUY→SELL": "합의 전환: 매수 → 매도",
  "HOLD→BUY": "합의 전환: 보유 → 매수",
  "HOLD→SELL": "합의 전환: 보유 → 매도",
  "SELL→BUY": "합의 전환: 매도 → 매수",
  "SELL→HOLD": "합의 전환: 매도 → 보유",
};

export interface NotifyResult {
  kind: "notified" | "duplicate" | "no-subscriptions" | "vapid-missing";
  flipId?: string;
  notifiedCount?: number;
}

export async function notifyFlip(args: {
  userId: string;
  detection: FlipDetection;
  displayName: string;
}): Promise<NotifyResult> {
  // 1. flip row INSERT — 24h dedup partial unique index 가 같은 날 중복 차단
  let flipRow: { id: string } | null = null;
  try {
    const [row] = await db
      .insert(stockConsensusFlips)
      .values({
        userId: args.userId,
        symbol: args.detection.symbol,
        fromVerdict: args.detection.fromVerdict,
        toVerdict: args.detection.toVerdict,
      })
      .returning({ id: stockConsensusFlips.id });
    flipRow = row;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("flips_dedup_uq")) {
      return { kind: "duplicate" };
    }
    throw err;
  }

  // 2. user subscriptions 로드
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, args.userId));

  if (subs.length === 0) {
    return { kind: "no-subscriptions", flipId: flipRow.id };
  }

  // 3. web-push 발송 (직렬 — VAPID rate-limit 친화)
  const key = `${args.detection.fromVerdict}→${args.detection.toVerdict}`;
  const title = FLIP_TITLE[key] ?? `${args.detection.symbol} 합의 전환`;
  const body = `${args.displayName}: ${args.detection.fromVerdict} → ${args.detection.toVerdict} (본 알림은 LLM 가상 의견이며 투자 자문이 아닙니다)`;

  let notifiedCount = 0;
  const expiredEndpoints: string[] = [];
  let vapidMissing = false;

  for (const sub of subs) {
    const result = await sendPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      {
        title,
        body,
        url: `/?symbol=${args.detection.symbol}`,
        tag: `flip-${args.detection.symbol}`,
      },
    );
    if (result.kind === "sent") {
      notifiedCount += 1;
    } else if (result.kind === "expired") {
      expiredEndpoints.push(result.endpoint);
    } else if (result.kind === "vapid-missing") {
      vapidMissing = true;
      break;
    }
  }

  // 4. 만료된 구독 정리
  if (expiredEndpoints.length > 0) {
    for (const ep of expiredEndpoints) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ep));
    }
  }

  // 5. notified_at 갱신 (적어도 1건 발송 성공이면 마킹)
  if (notifiedCount > 0) {
    await db
      .update(stockConsensusFlips)
      .set({ notifiedAt: new Date() })
      .where(eq(stockConsensusFlips.id, flipRow.id));
  }

  if (vapidMissing) return { kind: "vapid-missing", flipId: flipRow.id };
  return { kind: "notified", flipId: flipRow.id, notifiedCount };
}
```

⚠️ **VAPID_PUBLIC/PRIVATE_KEY 가 placeholder/누락 면** `sendPush` 가 `vapid-missing` 반환 → 알림 발송 없이 flip row 만 남음 (notified_at = NULL). 같은 날 dedup unique index 가 다음 cron 의 같은 (user, symbol) INSERT 차단 → **이번 운영의 placeholder VAPID 는 실제 키로 교체할 때까지 알림 안 감**. spec §10 후속 — 사용자 작업.

- [ ] **Step 2: typecheck + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/stock-push-flip/
git commit -m "feat(stock-analysis): notifyFlip — flips INSERT + web-push 발송 + 만료 구독 정리"
```

---

## Task 7.4: /api/cron/stock-analyze route

**Files:**
- Create: `apps/dashboard/src/app/api/cron/stock-analyze/route.ts`

`?market=KR|US_GLOBAL` 쿼리. `createCronHandler` 패턴 + `analyzeStock` per-symbol + 결과 받아 `detectConsensusFlip` + `notifyFlip` (user 별).

- [ ] **Step 1: route.ts**

```ts
// 일 2회 cron — 자산군별 라우팅.
//   ?market=KR        : KST 16:30 (장 마감 후)
//   ?market=US_GLOBAL : KST 06:30 (US 장 마감 + crypto/commodity 일중)
//
// 흐름:
//   1. portfolio_holdings 에서 market 필터로 unique symbol + holders 그룹핑
//   2. 각 symbol 별 analyzeStock (글로벌 캐시) — 같은 symbol 가진 holder 들에 공유
//   3. detectConsensusFlip(yesterday vs today) 1회 (글로벌 캐시라 holder 무관 결과 동일)
//   4. flip 감지 시 holders 각각에 notifyFlip (flips INSERT + web-push)
import { sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { analyzeStock } from "@/features/stock-analysis-server";
import {
  detectConsensusFlip,
  notifyFlip,
} from "@/features/stock-push-flip";

export const dynamic = "force-dynamic";

/** KST 'YYYY-MM-DD' (offset 일 단위). */
function kstDate(offsetDays = 0): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 86_400_000);
  return kst.toISOString().slice(0, 10);
}

type Market = "KR" | "US_GLOBAL";

interface SymbolTarget {
  symbol: string;
  displayName: string;
  assetClass: "stock" | "crypto" | "commodity";
  market: string;
  holders: { userId: string }[];
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = (searchParams.get("market") ?? "") as Market;

  if (market !== "KR" && market !== "US_GLOBAL") {
    return new Response(
      JSON.stringify({ error: "market=KR|US_GLOBAL 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const marketFilter =
    market === "KR"
      ? sql`${portfolioHoldings.market} = 'KR'`
      : sql`${portfolioHoldings.market} IN ('US','CRYPTO','COMMODITY')`;

  const handler = createCronHandler<SymbolTarget, { cached: boolean; flipped: number; notified: number }>({
    name: `stock-analyze-${market.toLowerCase()}`,
    targetSelect: async () => {
      const rows = await db
        .select({
          symbol: portfolioHoldings.symbol,
          displayName: portfolioHoldings.displayName,
          assetClass: portfolioHoldings.assetClass,
          market: portfolioHoldings.market,
          userId: portfolioHoldings.userId,
        })
        .from(portfolioHoldings)
        .where(marketFilter);

      const grouped = new Map<string, SymbolTarget>();
      for (const r of rows) {
        const existing = grouped.get(r.symbol);
        if (existing) {
          existing.holders.push({ userId: r.userId });
        } else {
          grouped.set(r.symbol, {
            symbol: r.symbol,
            displayName: r.displayName,
            assetClass: r.assetClass as SymbolTarget["assetClass"],
            market: r.market,
            holders: [{ userId: r.userId }],
          });
        }
      }
      return [...grouped.values()];
    },
    getId: (t) => t.symbol,
    getLabel: (t) => `${t.symbol} (${t.holders.length}명)`,
    perTarget: async (t) => {
      // 1. 글로벌 캐시 갱신.
      // analyzeStock 내부가 항상 userId=null 로 cache upsert (글로벌 캐시 정책).
      // 호출 시 넘기는 userId 는 persona model override resolve 용도 — 첫 holder 의 것 사용.
      // (persona override 차이가 cache 결과에 미치는 영향은 v1 에서 무시 — spec §6 정책)
      const firstHolder = t.holders[0];
      const result = await analyzeStock({
        symbol: t.symbol,
        displayName: t.displayName,
        assetClass: t.assetClass,
        market: t.market,
        userId: firstHolder.userId,
      });

      // 2. flip detect 1회 (글로벌 캐시라 holder 무관 동일)
      const detection = await detectConsensusFlip({
        symbol: t.symbol,
        yesterdayDate: kstDate(-1),
        todayDate: kstDate(0),
      });

      let flipped = 0;
      let notified = 0;
      if (detection) {
        flipped = t.holders.length;
        for (const holder of t.holders) {
          const notifyResult = await notifyFlip({
            userId: holder.userId,
            detection,
            displayName: t.displayName,
          });
          if (notifyResult.kind === "notified") notified += 1;
        }
      }

      return {
        cached: result.status !== "failed",
        flipped,
        notified,
      };
    },
    concurrency: 2,
  });

  return handler(request);
}
```

**analyzeStock 시그니처 (T0 검증 결과)**: `{ symbol, displayName, assetClass: PortfolioHolding["assetClass"], market, userId: string }` 받고 `{ status: "success"|"partial"|"failed", personas, consensus, marketSnapshot }` 반환. 캐시 INSERT 는 함수 내부가 항상 `userId=null` 로 처리 (글로벌 캐시 정책). 호출 시 넘기는 `userId` 는 persona model override resolve 용도라 holder 의 user_id 를 그대로 넘김.

- [ ] **Step 2: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/app/api/cron/stock-analyze/
git commit -m "feat(stock-analysis): /api/cron/stock-analyze?market= (KR/US_GLOBAL 자산군 라우팅 + flip 감지 + push)"
```

---

## Task 7.5: apps/cron scheduler.js 에 두 스케줄 추가

**Files:**
- Modify: `apps/cron/scheduler.js`

KST 16:30 KR + 06:30 US_GLOBAL. 기존 스케줄(poll-gmail 매시간, morning-digest 08:00, daily-fortunes 00:01, daily-tri 00:05) 뒤에 추가.

- [ ] **Step 1: scheduler.js 갱신**

기존 마지막 `cron.schedule` 블럭 (`generate-daily-tri-fortunes`) 뒤에 추가:

```js
// 매일 16:30 KST — KR 종목 재분석 + flip 알림.
cron.schedule(
  "30 16 * * *",
  () => {
    void callCron("/api/cron/stock-analyze?market=KR", "stock-analyze-kr");
  },
  { timezone: TIMEZONE },
);

// 매일 06:30 KST — US/Crypto/Commodity 재분석 + flip 알림.
cron.schedule(
  "30 6 * * *",
  () => {
    void callCron(
      "/api/cron/stock-analyze?market=US_GLOBAL",
      "stock-analyze-us-global",
    );
  },
  { timezone: TIMEZONE },
);
```

스케줄 등록 console.log 도 갱신:
```js
console.log(
  "[cron] 스케줄 등록 완료. polling=0 * * * *, digest=0 8 * * * KST, daily-fortunes=1 0 * * * KST, daily-tri=5 0 * * * KST, stock-kr=30 16 * * * KST, stock-us=30 6 * * * KST",
);
```

- [ ] **Step 2: 검증 + commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/cron/scheduler.js
git commit -m "feat(stock-analysis): cron scheduler 에 stock-analyze KR/US 스케줄 추가 (16:30/06:30 KST)"
```

---

## Task 7.6: Unit/통합 테스트

**Files:**
- Create: `apps/dashboard/tests/stock-push-flip.test.ts`

DB 통합 — `TEST_DATABASE_URL` 필요. 미기동 시 ECONNREFUSED 로 skip 가능.

- [ ] **Step 1: tests/stock-push-flip.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockAnalysisCache,
  stockConsensusFlips,
  pushSubscriptions,
  users,
  portfolioHoldings,
} from "@/shared/lib/db/schema";
import { detectConsensusFlip } from "@/features/stock-push-flip/api/detect";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000999";

describe("detectConsensusFlip", () => {
  beforeEach(async () => {
    await db.delete(stockConsensusFlips);
    await db.delete(stockAnalysisCache);
    await db.delete(pushSubscriptions);
    await db.delete(portfolioHoldings);
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    await db.insert(users).values({
      id: TEST_USER_ID,
      name: "test",
      email: "test@example.com",
    });
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("어제와 오늘 verdict 가 다르고 prompt_version 같으면 flip 반환", async () => {
    await db.insert(stockAnalysisCache).values([
      {
        symbol: "TEST",
        analysisDate: "2026-05-20",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
      {
        symbol: "TEST",
        analysisDate: "2026-05-21",
        userId: null,
        personas: {},
        consensus: { verdict: "HOLD" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
    ]);

    const result = await detectConsensusFlip({
      symbol: "TEST",
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });

    expect(result).toEqual({
      symbol: "TEST",
      fromVerdict: "BUY",
      toVerdict: "HOLD",
    });
  });

  it("prompt_version 다르면 null", async () => {
    await db.insert(stockAnalysisCache).values([
      {
        symbol: "TEST",
        analysisDate: "2026-05-20",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
      {
        symbol: "TEST",
        analysisDate: "2026-05-21",
        userId: null,
        personas: {},
        consensus: { verdict: "HOLD" } as never,
        marketSnapshot: {},
        promptVersion: "2",
      },
    ]);

    const result = await detectConsensusFlip({
      symbol: "TEST",
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });
    expect(result).toBeNull();
  });

  it("같은 verdict 면 null", async () => {
    await db.insert(stockAnalysisCache).values([
      {
        symbol: "TEST",
        analysisDate: "2026-05-20",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
      {
        symbol: "TEST",
        analysisDate: "2026-05-21",
        userId: null,
        personas: {},
        consensus: { verdict: "BUY" } as never,
        marketSnapshot: {},
        promptVersion: "1",
      },
    ]);

    const result = await detectConsensusFlip({
      symbol: "TEST",
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });
    expect(result).toBeNull();
  });

  it("어제 row 가 없으면 null (신규 종목)", async () => {
    await db.insert(stockAnalysisCache).values({
      symbol: "TEST",
      analysisDate: "2026-05-21",
      userId: null,
      personas: {},
      consensus: { verdict: "BUY" } as never,
      marketSnapshot: {},
      promptVersion: "1",
    });

    const result = await detectConsensusFlip({
      symbol: "TEST",
      yesterdayDate: "2026-05-20",
      todayDate: "2026-05-21",
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 로컬 검증 (옵션)**

```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine

TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test stock-push-flip
```

- [ ] **Step 3: commit**

```bash
git add apps/dashboard/tests/stock-push-flip.test.ts
git commit -m "test(stock-analysis): detectConsensusFlip 4 케이스 (flip / version mismatch / same / 신규)"
```

---

## Task 7.7: 통합 검증 + PR

- [ ] **Step 1: typecheck**: `pnpm typecheck` PASS
- [ ] **Step 2: lint**: `cd apps/dashboard && pnpm lint` PASS
- [ ] **Step 3: build**: `cd apps/dashboard && pnpm build` PASS (Phase 6 가 가르쳐준 교훈 — typecheck/lint 만으로는 client/server seam 못 잡음)
- [ ] **Step 4: test**: `TEST_DATABASE_URL=... pnpm test` (로컬 미연결이면 skip)
- [ ] **Step 5: commit 확인**: `git log --oneline origin/main..HEAD` → 5~6 commit (T7.1~T7.6)
- [ ] **Step 6: push + PR**

```bash
git push -u origin feat/stock-analysis-phase-7

gh pr create --title "feat(stock-analysis): Phase 7 — Cron + Flip Push" --body "$(cat <<'EOF'
## Summary

- `stock_consensus_flips` 에 `flips_dedup_uq` partial unique index 추가 (24h 1회 cap, spec §2.1 #4)
- `detectConsensusFlip(symbol, yesterday, today)` — 글로벌 캐시 두 row 비교, `prompt_version` 일치 시만
- `notifyFlip(userId, detection, displayName)` — `stock_consensus_flips` INSERT (unique violation catch) + user push subscriptions 발송 + 만료 구독 정리 + `notified_at` 갱신
- `/api/cron/stock-analyze?market=KR|US_GLOBAL` — Bearer 인증, `createCronHandler` 셰이프, concurrency 2
- `apps/cron/scheduler.js` 에 KST 16:30 (KR) + 06:30 (US_GLOBAL) 스케줄 등록
- `detectConsensusFlip` 4 케이스 통합 테스트

## Notes

- **자산군 라우팅**: `market='KR'` → KST 16:30 (장 마감 후), `market IN ('US','CRYPTO','COMMODITY')` → KST 06:30 (US 장 마감 + crypto/commodity 일중).
- **글로벌 vs user-specific 캐시**: 같은 종목은 한 번만 분석 (cache userId=NULL). flip 판정/알림은 user 별.
- **24h 1회 cap**: `flips_dedup_uq` partial unique index = (user_id, symbol, detected_at::date). cron 이 INSERT 시도 → unique violation catch → skip.
- **만료 구독 정리**: web-push 404/410 응답 시 `pushSubscriptions` row DELETE.
- **VAPID 누락 시**: `sendPush` 가 `vapid-missing` 반환 → `notified_at` NULL 유지 → 같은 날 dedup 차단으로 retry 안 됨. **VAPID 실제 키 교체 후 다음 날 cron 부터 정상 알림** (spec §10 후속).

## 우려사항

- **VAPID 정식 키 부재 시 첫날 알림 손실** — 24h dedup 정책상 첫 cron 에서 INSERT 만 되고 notify 못 함. 실제 운영은 VAPID 교체일 부터 정상.
- **rate-limit / LLM 비용 spike**: concurrency 2 + 글로벌 캐시로 같은 symbol 단 1회 분석. portfolio 10종목 가정 시 일 2 cron × 평균 5종목 = 10회 호출.
- **process crash 회복**: cron 도중 crash → 일부 종목만 분석. 다음 cron 에서 글로벌 캐시가 어제 row 없으면 detect 가 null 반환 — 즉 안전.

## Spec / Plan

- Spec: docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md §2, §2.1 #4, §7
- Plan: docs/superpowers/plans/2026-05-21-stock-analysis-widget/phase-7-cron-flip.md

## Test plan

- [x] pnpm typecheck PASS
- [x] cd apps/dashboard && pnpm lint PASS
- [x] cd apps/dashboard && pnpm build PASS
- [x] pnpm test (detectConsensusFlip 4 케이스)
- [ ] (수동) 운영 마이그레이션 적용
- [ ] (수동) docker compose up -d app cron — cron 컨테이너 로그에서 stock-kr=30 16 등록 확인
- [ ] (수동) curl -X POST -H "Authorization: Bearer \$TOKEN" 'https://gons.krdn.kr/api/cron/stock-analyze?market=US_GLOBAL' → 200 envelope

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 self-check

- [ ] `pnpm typecheck && lint && test && build` PASS
- [ ] `flips_dedup_uq` partial unique index 정상 (운영 마이그레이션 후)
- [ ] cron 컨테이너 로그에 스케줄 2건 등록 메시지
- [ ] `/api/cron/stock-analyze?market=US_GLOBAL` 수동 호출 → 200 envelope (총/성공/실패 카운트)
- [ ] portfolio holders 있는 symbol 한해 stock_analysis_cache row 갱신
- [ ] verdict 다른 row 있을 때 `stock_consensus_flips` INSERT + notified_at 채워짐 (VAPID 정식 키 후)

Phase 7 PR 머지 후 Phase 8 (Browser 검증 + 문서) 진입.

---

## 횡단 관심사 (Phase 7 갱신)

- **글로벌 vs user-specific 캐시**: 글로벌 only. user-specific 캐시는 v1.2 backlog.
- **flip 24h cap**: partial unique index 로 DB 레벨 강제. application 레벨 시계 의존 로직 제거 — 안전.
- **prompt_version 무효화**: detect 가 비교 무의미 시 null. spec §3 캐시 정책 일관.
- **fire-and-forget vs await**: cron 은 `await` (createCronHandler 가 모든 fetch 끝까지 기다림). Phase 6 의 fire-and-forget 패턴은 lazy trigger 전용.
- **rate-limit (Phase 6) vs cron (Phase 7)**: in-memory rate-limit 은 사용자 lazy trigger 전용. cron 은 server→server 라 rate-limit 우회 (concurrency 만 제어).
- **24h cap + VAPID 부재 race**: VAPID 없는 동안 flip row 만 INSERT 되고 알림은 못 가는 첫날 손실. v1 단순화 수용.
- **features barrel server/client seam**: stock-push-flip 은 server-only (UI 없음). client.ts 없어도 OK. RSC/route/cron 만 호출.
