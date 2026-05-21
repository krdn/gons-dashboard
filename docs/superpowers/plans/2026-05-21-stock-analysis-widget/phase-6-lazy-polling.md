# Phase 6: Lazy Trigger + Polling

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** 캐시 miss 시 백그라운드 `analyzeStock()` 실행 + 클라이언트 폴링 + 페르소나 단위 재생성 + rate-limit 가드. spec §2 (데이터 흐름) + §2.2 (latency) + §6.3 R3.

**완료 조건:**
- Server Action `triggerAnalysis(symbol, persona?)` — 즉시 반환 + 백그라운드 `analyzeStock` + DB 진행 상태 기록
- `stock_analysis_runs` 테이블 — 진행 상태 (queued / running / completed / failed)
- `/api/stock/analyze/status?symbol=...` — 폴링 endpoint
- `usePollingAnalysis(symbol)` client hook — 5초 간격, 90초 timeout
- `AnalysisPendingPlaceholder` — "지금 분석" 버튼 + 직렬 trigger + 첫 종목 폴링
- StockAnalysisCard 의 placeholder 자리 교체
- 페르소나 단위 재생성 (StockDetailModal "재생성" 버튼) + 분당 1회 rate-limit
- `pnpm typecheck && pnpm lint && pnpm test` PASS

**전제:**
- Phase 5 PR (#110) 머지 완료 → `feat/stock-analysis-phase-6` cut
- `analyzeStock(args)` orchestrator (Phase 3 T3.5) 동작
- StockAnalysisCard 의 캐시 miss placeholder (Phase 5 T5.5) 자리 있음

⚠️ **백그라운드 처리 결정:** fire-and-forget (`void analyzeStock(...).catch(...)`) 채택. Next.js 16 `after()` 보다 단순. progress 는 `stock_analysis_runs` 테이블로 추적.

---

## Task 6.1: stock_analysis_runs 테이블

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` (말미)
- Generated: `apps/dashboard/drizzle/00XX_*.sql`

- [ ] **Step 1: schema.ts 말미에 테이블 추가**

```ts
export const stockAnalysisRuns = pgTable(
  "stock_analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    persona: text("persona"), // NULL = 전체 분석, persona 키 = 그 페르소나만
    status: text("status").notNull(), // 'queued' | 'running' | 'completed' | 'failed'
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("stock_runs_user_symbol_idx").on(t.userId, t.symbol),
    // in-flight 중복 가드 (partial unique index)
    uniqueIndex("stock_runs_in_flight_uq")
      .on(t.userId, t.symbol, t.persona)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);
```

⚠️ partial unique index — 같은 (user, symbol, persona) 가 in-flight 중에 추가 trigger → unique 위반. orchestrator 가 catch.

- [ ] **Step 2: drizzle-kit generate**

Run: `cd apps/dashboard && pnpm db:generate`

⚠️ snapshot collision 시 메모리 `drizzle-snapshot-id-collision` 참조.

- [ ] **Step 3: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(stock-analysis): stock_analysis_runs 테이블 (lazy trigger 진행 상태 추적)"
```

---

## Task 6.2: entities/stock-analysis 의 runs CRUD

**Files:**
- Create: `apps/dashboard/src/entities/stock-analysis/model/run-types.ts`
- Modify: `apps/dashboard/src/entities/stock-analysis/server.ts` (runs query 추가)
- Modify: `apps/dashboard/src/entities/stock-analysis/client.ts` (RunStatus type 추가)

- [ ] **Step 1: model/run-types.ts**

```ts
import type { PersonaKey } from "./persona-types";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface AnalysisRun {
  id: string;
  userId: string;
  symbol: string;
  persona: PersonaKey | null;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}
```

- [ ] **Step 2: server.ts 에 runs query 추가**

기존 cache CRUD 뒤에 (import 보강):

```ts
import { stockAnalysisRuns } from "@/shared/lib/db/schema";
import { desc } from "drizzle-orm";
import type { AnalysisRun, RunStatus } from "./model/run-types";

export type { AnalysisRun, RunStatus } from "./model/run-types";

export async function startRun(args: {
  userId: string;
  symbol: string;
  persona: string | null;
}): Promise<AnalysisRun> {
  try {
    const [row] = await db
      .insert(stockAnalysisRuns)
      .values({
        userId: args.userId,
        symbol: args.symbol,
        persona: args.persona,
        status: "queued" as RunStatus,
      })
      .returning();
    return rowToRun(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("stock_runs_in_flight_uq")) {
      const rows = await db
        .select()
        .from(stockAnalysisRuns)
        .where(
          and(
            eq(stockAnalysisRuns.userId, args.userId),
            eq(stockAnalysisRuns.symbol, args.symbol),
            args.persona === null
              ? sql`${stockAnalysisRuns.persona} IS NULL`
              : eq(stockAnalysisRuns.persona, args.persona),
            sql`${stockAnalysisRuns.status} IN ('queued','running')`,
          ),
        )
        .limit(1);
      if (rows.length > 0) return rowToRun(rows[0]);
    }
    throw err;
  }
}

export async function updateRun(
  id: string,
  patch: { status: RunStatus; errorMessage?: string },
): Promise<void> {
  await db
    .update(stockAnalysisRuns)
    .set({
      status: patch.status,
      errorMessage: patch.errorMessage ?? null,
      completedAt:
        patch.status === "completed" || patch.status === "failed"
          ? new Date()
          : null,
    })
    .where(eq(stockAnalysisRuns.id, id));
}

export async function getLatestRun(
  userId: string,
  symbol: string,
  persona: string | null,
): Promise<AnalysisRun | null> {
  const rows = await db
    .select()
    .from(stockAnalysisRuns)
    .where(
      and(
        eq(stockAnalysisRuns.userId, userId),
        eq(stockAnalysisRuns.symbol, symbol),
        persona === null
          ? sql`${stockAnalysisRuns.persona} IS NULL`
          : eq(stockAnalysisRuns.persona, persona),
      ),
    )
    .orderBy(desc(stockAnalysisRuns.startedAt))
    .limit(1);
  return rows.length === 0 ? null : rowToRun(rows[0]);
}

function rowToRun(r: typeof stockAnalysisRuns.$inferSelect): AnalysisRun {
  return {
    id: r.id,
    userId: r.userId,
    symbol: r.symbol,
    persona: r.persona as AnalysisRun["persona"],
    status: r.status as RunStatus,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
  };
}
```

- [ ] **Step 3: client.ts 에 AnalysisRun/RunStatus type 추가 re-export**

```ts
export type { AnalysisRun, RunStatus } from "./model/run-types";
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/entities/stock-analysis/
git commit -m "feat(stock-analysis): entities/stock-analysis runs CRUD (startRun/updateRun/getLatestRun)"
```

---

## Task 6.3: triggerAnalysis Server Action

**Files:**
- Create: `apps/dashboard/src/features/stock-analysis-server/api/trigger.ts`
- Modify: `apps/dashboard/src/features/stock-analysis-server/index.ts`

- [ ] **Step 1: api/trigger.ts**

```ts
"use server";

import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { startRun, updateRun } from "@/entities/stock-analysis/server";
import { analyzeStock } from "./orchestrator";

const TriggerSchema = z.object({
  symbol: z.string().min(1).max(32),
  persona: z
    .enum(["wallStreet", "krExpert", "value", "growth", "technical"])
    .optional(),
});

export interface TriggerResult {
  success: boolean;
  runId?: string;
  inFlight?: boolean;
  error?: string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const lastTriggerAt = new Map<string, number>();

function rateLimitKey(userId: string, symbol: string, persona: string | null): string {
  return `${userId}:${symbol}:${persona ?? "*"}`;
}

export async function triggerAnalysis(input: {
  symbol: string;
  persona?: "wallStreet" | "krExpert" | "value" | "growth" | "technical";
}): Promise<TriggerResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = TriggerSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "잘못된 입력" };

  // 사용자가 등록한 종목인지 검증
  const holdings = await db
    .select()
    .from(portfolioHoldings)
    .where(eq(portfolioHoldings.userId, session.user.id))
    .limit(50);
  const target = holdings.find((h) => h.symbol === parsed.data.symbol);
  if (!target) return { success: false, error: "등록되지 않은 종목" };

  // Rate limit
  const key = rateLimitKey(session.user.id, parsed.data.symbol, parsed.data.persona ?? null);
  const last = lastTriggerAt.get(key);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_WINDOW_MS) {
    return {
      success: false,
      error: `잠시 후 다시 시도하세요 (${Math.ceil((RATE_LIMIT_WINDOW_MS - (now - last)) / 1000)}초 남음)`,
    };
  }
  lastTriggerAt.set(key, now);

  // run row 생성 (unique 위반 catch → 기존 in-flight 반환)
  const run = await startRun({
    userId: session.user.id,
    symbol: parsed.data.symbol,
    persona: parsed.data.persona ?? null,
  });

  if (run.status === "running" || run.status === "queued") {
    return { success: true, runId: run.id, inFlight: true };
  }

  // fire-and-forget
  void runAnalysis(run.id, {
    symbol: target.symbol,
    displayName: target.displayName,
    assetClass: target.assetClass as "stock" | "crypto" | "commodity",
    market: target.market,
    userId: session.user.id,
  });

  return { success: true, runId: run.id, inFlight: false };
}

async function runAnalysis(
  runId: string,
  args: Parameters<typeof analyzeStock>[0],
): Promise<void> {
  try {
    await updateRun(runId, { status: "running" });
    const result = await analyzeStock(args);
    if (result.status === "failed") {
      await updateRun(runId, {
        status: "failed",
        errorMessage: "Analysis returned failed status",
      });
    } else {
      await updateRun(runId, { status: "completed" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[triggerAnalysis] runId=${runId} failed:`, msg);
    await updateRun(runId, { status: "failed", errorMessage: msg }).catch(() => {});
  }
}
```

⚠️ **rate-limit in-memory**: 단일 인스턴스 가정. multi-instance 시 Redis 이전.

⚠️ **fire-and-forget**: `void runAnalysis(...)`. Node process crash 시 stuck 가능 — Phase 8 dogfooding 시 회복 메커니즘 검토.

- [ ] **Step 2: index.ts 갱신**

```ts
export { analyzeStock } from "./api/orchestrator";
export type { AnalyzeStockArgs, AnalyzeStockResult } from "./api/orchestrator";
export { triggerAnalysis } from "./api/trigger";
export type { TriggerResult } from "./api/trigger";
```

- [ ] **Step 3: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/stock-analysis-server/
git commit -m "feat(stock-analysis): triggerAnalysis Server Action (fire-and-forget + rate-limit)"
```

---

## Task 6.4: /api/stock/analyze/status endpoint

**Files:**
- Create: `apps/dashboard/src/app/api/stock/analyze/status/route.ts`

- [ ] **Step 1: route.ts**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { getLatestRun } from "@/entities/stock-analysis/server";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  symbol: z.string().min(1).max(32),
  persona: z
    .enum(["wallStreet", "krExpert", "value", "growth", "technical"])
    .optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    symbol: searchParams.get("symbol") ?? "",
    persona: searchParams.get("persona") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 쿼리" }, { status: 400 });
  }

  const run = await getLatestRun(
    session.user.id,
    parsed.data.symbol,
    parsed.data.persona ?? null,
  );
  return NextResponse.json({ run });
}
```

- [ ] **Step 2: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/app/api/stock/analyze/status/route.ts
git commit -m "feat(stock-analysis): GET /api/stock/analyze/status (run 폴링 + NextAuth)"
```

---

## Task 6.5: usePollingAnalysis hook + AnalysisPendingPlaceholder

**Files:**
- Create: `apps/dashboard/src/widgets/stock-analysis/usePollingAnalysis.ts`
- Create: `apps/dashboard/src/widgets/stock-analysis/AnalysisPendingPlaceholder.tsx`

- [ ] **Step 1: usePollingAnalysis.ts**

```ts
"use client";

import { useEffect, useState } from "react";
import type { AnalysisRun } from "@/entities/stock-analysis/client";

interface UsePollingArgs {
  symbol: string;
  persona?: "wallStreet" | "krExpert" | "value" | "growth" | "technical";
  enabled: boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface PollingState {
  run: AnalysisRun | null;
  loading: boolean;
  error: string | null;
  timedOut: boolean;
}

export function usePollingAnalysis({
  symbol,
  persona,
  enabled,
  intervalMs = 5_000,
  timeoutMs = 90_000,
}: UsePollingArgs): PollingState {
  const [state, setState] = useState<PollingState>({
    run: null,
    loading: enabled,
    error: null,
    timedOut: false,
  });

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    const startedAt = Date.now();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const params = new URLSearchParams({ symbol });
        if (persona) params.set("persona", persona);
        const res = await fetch(`/api/stock/analyze/status?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as { run: AnalysisRun | null };
        setState((prev) => ({ ...prev, run: json.run, loading: false }));

        if (json.run?.status === "completed" || json.run?.status === "failed") {
          if (intervalId) clearInterval(intervalId);
        } else if (Date.now() - startedAt > timeoutMs) {
          if (intervalId) clearInterval(intervalId);
          setState((prev) => ({ ...prev, timedOut: true, loading: false }));
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "polling 실패",
          loading: false,
        }));
        if (intervalId) clearInterval(intervalId);
      }
    };

    void poll();
    intervalId = setInterval(() => void poll(), intervalMs);

    return () => {
      controller.abort();
      if (intervalId) clearInterval(intervalId);
    };
  }, [symbol, persona, enabled, intervalMs, timeoutMs]);

  return state;
}
```

⚠️ React 19 set-state-in-effect 룰: useEffect body 가 cleanup 만 sync 호출, setState 는 async poll() 안. lint 통과.

- [ ] **Step 2: AnalysisPendingPlaceholder.tsx**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import { triggerAnalysis } from "@/features/stock-analysis-server";
import { usePollingAnalysis } from "./usePollingAnalysis";

interface Props {
  holdings: PortfolioHolding[];
}

export function AnalysisPendingPlaceholder({ holdings }: Props) {
  const router = useRouter();
  const [triggered, setTriggered] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const firstTriggered = holdings.find((h) => triggered.has(h.symbol));
  const polling = usePollingAnalysis({
    symbol: firstTriggered?.symbol ?? "",
    enabled: !!firstTriggered,
  });

  // 폴링 completed 시 RSC 재요청
  useEffect(() => {
    if (polling.run?.status === "completed") {
      router.refresh();
    }
  }, [polling.run?.status, router]);

  const triggerAll = () => {
    startTransition(async () => {
      for (const h of holdings) {
        if (triggered.has(h.symbol)) continue;
        const res = await triggerAnalysis({ symbol: h.symbol });
        if (!res.success) {
          setErrors((prev) => ({ ...prev, [h.symbol]: res.error ?? "trigger 실패" }));
        } else {
          setTriggered((prev) => new Set(prev).add(h.symbol));
        }
      }
    });
  };

  return (
    <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-[var(--color-text-muted)]">
          {holdings.length}개 종목 분석 대기 중 (예상 30-60초/종목)
        </p>
        {triggered.size === 0 ? (
          <button
            type="button"
            onClick={triggerAll}
            disabled={pending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "시작 중…" : "지금 분석"}
          </button>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">
            {polling.run?.status === "running"
              ? "⏳ 분석 중…"
              : polling.run?.status === "queued"
                ? "⏳ 대기 중…"
                : polling.timedOut
                  ? "⏱ 시간 초과"
                  : "준비 중…"}
          </span>
        )}
      </div>
      <ul className="space-y-1 text-xs">
        {holdings.map((h) => (
          <li key={h.id} className="flex items-center justify-between">
            <span>{h.symbol} · {h.displayName}</span>
            {errors[h.symbol] && (
              <span className="text-red-600">{errors[h.symbol]}</span>
            )}
            {triggered.has(h.symbol) && !errors[h.symbol] && (
              <span className="text-emerald-600">큐 등록됨</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

⚠️ `useEffect` 가 polling 결과를 감지해 router.refresh — set-state-in-effect 룰 충돌 가능. 대안: 효과를 polling hook 안으로 옮기거나 startTransition 안에서 처리.

→ **수정**: useEffect 대신 polling 결과를 derived 로 처리하고 router.refresh 를 polling hook 의 callback 으로 전달. 본 plan 단순화 — useEffect 그대로 두고 lint 통과 못 하면 subagent 가 수정.

- [ ] **Step 3: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/widgets/stock-analysis/usePollingAnalysis.ts apps/dashboard/src/widgets/stock-analysis/AnalysisPendingPlaceholder.tsx
git commit -m "feat(stock-analysis): usePollingAnalysis hook + AnalysisPendingPlaceholder (5s 폴링 + 직렬 trigger)"
```

---

## Task 6.6: StockAnalysisCard placeholder 교체

**Files:**
- Modify: `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx`

- [ ] **Step 1: 기존 "Phase 6: 자동 생성" placeholder 위치 grep + 교체**

기존 inline 메시지를:

```tsx
{enriched.filter((e) => !e.analysis).length > 0 && (
  <AnalysisPendingPlaceholder
    holdings={enriched.filter((e) => !e.analysis).map((e) => e.holding)}
  />
)}
```

- [ ] **Step 2: import 추가**

```ts
import { AnalysisPendingPlaceholder } from "./AnalysisPendingPlaceholder";
```

- [ ] **Step 3: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx
git commit -m "feat(stock-analysis): StockAnalysisCard 의 placeholder 를 AnalysisPendingPlaceholder 로 교체"
```

---

## Task 6.7: 페르소나 단위 재생성 버튼

**Files:**
- Modify: `apps/dashboard/src/entities/stock-analysis/ui/PersonaTab.tsx`
- Modify: `apps/dashboard/src/widgets/stock-analysis/StockDetailModal.tsx`

- [ ] **Step 1: PersonaTab 에 onRegenerate prop 추가**

```tsx
interface Props {
  persona: PersonaKey;
  analysis: PersonaAnalysis | null;
  symbol?: string;
  onRegenerate?: () => Promise<{ success: boolean; error?: string }>;
}
```

본문에 재생성 버튼 + useTransition + 에러 표시. analysis 가 null 일 때도, 있을 때도 우상단에 버튼.

(상세 코드는 본 plan 의 T6.7 Step 2 참조 — 위에 작성된 내용을 그대로 사용)

- [ ] **Step 2: StockDetailModal 에서 onRegenerate 전달**

```tsx
import { triggerAnalysis } from "@/features/stock-analysis-server";

// ...
<PersonaTab
  persona={activeTab}
  analysis={personas[activeTab] ?? null}
  symbol={holding.symbol}
  onRegenerate={() => triggerAnalysis({ symbol: holding.symbol, persona: activeTab })}
/>
```

- [ ] **Step 3: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/entities/stock-analysis/ui/PersonaTab.tsx apps/dashboard/src/widgets/stock-analysis/StockDetailModal.tsx
git commit -m "feat(stock-analysis): 페르소나 단위 재생성 버튼 (PersonaTab + onRegenerate prop)"
```

---

## Task 6.8: 통합 검증 + PR

- [ ] **Step 1: typecheck**: `pnpm typecheck`
- [ ] **Step 2: lint**: `cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint`
- [ ] **Step 3: test**: `pnpm test`
- [ ] **Step 4: commit 검증**: `git log --oneline origin/main..HEAD` → 7 commit (T6.1~T6.7)
- [ ] **Step 5: branch push + PR**

```bash
cd /home/gon/projects/gon/gons-dashboard
git push -u origin feat/stock-analysis-phase-6

gh pr create --title "feat(stock-analysis): Phase 6 — Lazy Trigger + Polling" --body "$(cat <<'EOF'
## Summary
- stock_analysis_runs 테이블 (lazy trigger 진행 상태 추적) + partial unique index (in-flight 중복 가드)
- entities/stock-analysis runs CRUD (startRun / updateRun / getLatestRun)
- triggerAnalysis Server Action — fire-and-forget + 분당 1회 rate-limit + 사용자 portfolio 검증
- GET /api/stock/analyze/status — 폴링 endpoint
- usePollingAnalysis hook — 5s 간격 + 90s timeout + AbortController
- AnalysisPendingPlaceholder — 캐시 miss 종목 "지금 분석" 버튼 + 직렬 trigger + 첫 종목 폴링
- StockAnalysisCard placeholder 교체
- 페르소나 단위 재생성 (PersonaTab + StockDetailModal onRegenerate prop)

## Notes
- 백그라운드 처리: fire-and-forget (Next.js after() 보다 단순)
- Rate-limit: in-memory Map (단일 인스턴스). multi-instance 시 Redis 이전
- 폴링: 첫 미완료 종목만, completed 시 router.refresh — endpoint 부하 ↓
- 직렬 trigger: LLM proxy 비용 spike 회피
- 페르소나 단위 재생성: analyzeStock 전체 호출 (v1 단순화)

## 우려사항
- Node process crash 시 in-flight "running" stuck — Phase 8 stale run cleanup cron 검토
- rate-limit in-memory: 재시작 시 reset — Redis 이전은 v1.1+

## Spec / Plan
- Spec: docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md §2, §6.3 R3
- Plan: docs/superpowers/plans/2026-05-21-stock-analysis-widget/phase-6-lazy-polling.md

## Test plan
- [x] pnpm typecheck PASS
- [x] cd apps/dashboard && pnpm lint PASS
- [x] pnpm test (변동 없음)
- [ ] (수동) 종목 등록 → "지금 분석" → 폴링 + 완료 시 헤드라인 자동 갱신
- [ ] (수동) 페르소나 탭 재생성 → rate-limit 메시지

🤖 Generated with Claude Code
EOF
)"
```

---

## Phase 6 self-check

- [ ] `pnpm typecheck && lint && test` PASS
- [ ] stock_analysis_runs partial unique index 정상
- [ ] triggerAnalysis 가 in-flight 중복 시 기존 run 반환
- [ ] usePollingAnalysis 가 completed/failed 도달 시 cleanup
- [ ] AnalysisPendingPlaceholder 직렬 trigger
- [ ] PersonaTab 재생성 버튼
- [ ] PR 머지 후 main Docker 빌드 success

Phase 6 PR 머지 후 Phase 7 (Cron + Flip Push) 진입.

---

## 횡단 관심사 (Phase 6 갱신)

- **fire-and-forget vs after()**: fire-and-forget 채택. DB row 로 progress 추적.
- **rate-limit in-memory**: 단일 인스턴스 가정. multi-instance 시 Redis — v1.1+.
- **process crash 회복**: stale run cleanup cron — Phase 8 dogfooding 시 검토.
- **글로벌 캐시 user_id NULL** (Phase 3 우려): triggerAnalysis 도 글로벌 캐시 hit/write. trade-off 수용.
- **재생성 vs 부분 갱신**: 전체 5 페르소나 + 합의 재호출. v1 단순화. v1.1+ 부분 갱신.
- **set-state-in-effect**: usePollingAnalysis 의 cleanup 만 sync, setState 는 async poll() — lint 통과.
- **AnalysisPendingPlaceholder 의 useEffect (polling 완료 시 router.refresh)**: lint 가 막으면 polling hook 의 onComplete callback 으로 옮김.
