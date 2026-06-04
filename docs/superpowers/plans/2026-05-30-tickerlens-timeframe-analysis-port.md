# Tickerlens 타임프레임 분석 이식 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ai-signalcraft에 잘못 추가된 `@krdn/tickerlens` 기반 "페르소나 × 타임프레임(장/중/단기)" 주식 분석을 gons-dashboard에 FSD 신규 기능으로 이식하고(기존 `@gons/stock-analysis` 페르소나×verdict 분석과 공존), ai-signalcraft의 원본은 제거한다.

**Architecture:** gons-dashboard(Next.js 16 App Router + FSD + Drizzle/PostgreSQL, tRPC 없음). tickerlens 결과 모델은 집계(consensus)가 없어 기존 `stock_analysis_cache`에 못 접으므로 **별도 신규 entity(`stock-timeframe`) + 신규 이력 테이블(`stock_timeframe_analyses`) + 신규 widget + `/stocks` 페이지**로 추가한다. 데이터레이어는 gons 관례(server action으로 분석 트리거 + API route/server-only Drizzle 조회)를 따르고, 12콜 LLM 차단을 피하기 위해 분석은 server action에서 await하되 `depth='lite'`(4콜)를 기본으로 한다. LLM 키는 gons의 프록시 방식(`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`)을 그대로 쓰는 얇은 `ModelConfigAdapter`로 연결한다.

**Tech Stack:** `@krdn/tickerlens@0.1.0` (github:krdn/tickerlens#v0.1.0), `@krdn/llm-gateway` (이미 의존), Drizzle ORM, Next.js Server Actions/RSC, Zod, Vitest.

---

## 결정 사항 (사용자 확정)

- ✅ **방향**: tickerlens 타임프레임 분석 capability를 원함 → 신규 기능으로 추가, 기존 stock 기능과 **공존**.
- ✅ **원본 처리**: ai-signalcraft의 stocks 원본 **제거(revert)**.
- ✅ **티커 입력**: US 전용 (tickerlens는 yfinance 기반 US 전용). gons의 KRX `stock-master` 검색과 통합하지 않음.
- ✅ **데이터레이어**: gons 관례(server action + RSC + API route), tRPC 미사용.
- ✅ **사용자 격리**: `requestedBy`(text, 격리 아님) → `userId`(uuid FK) 승격.
- ✅ **의존성 ref**: `"@krdn/tickerlens": "github:krdn/tickerlens#v0.1.0"` (gons의 `@krdn/saju`/`@krdn/llm-gateway` 관례와 동일).

## 핵심 제약 (조사에서 도출)

- tickerlens `AnalysisResult`: `{ ticker, asOf, snapshot, perspectives: { value/growth/quant/options: { long/mid/short: Result<PerspectiveResult> } }, meta }`. **집계 없음** — 페르소나(4) × 타임프레임(3) 그리드.
- `Signal = "strong_buy"|"buy"|"hold"|"sell"|"strong_sell"`. (gons의 `Verdict = BUY|HOLD|SELL`와 다름 — 별도 도메인)
- gons LLM: 프록시(`ANTHROPIC_BASE_URL=:8317`) + `ANTHROPIC_API_KEY`. tickerlens `composeTickerAnalysis(ticker, { configAdapter, depth })` 호출.
- gons `server-only` seam: entity는 `/server`(Drizzle/Node)와 `/client`(타입/UI) barrel 분리 필수. tickerlens는 `composeTickerAnalysis`만 server에서 호출.

---

## File Structure

**gons-dashboard 신규/수정:**

| 파일 | 책임 |
|---|---|
| `apps/dashboard/package.json` (수정) | `@krdn/tickerlens` 의존성 추가 |
| `apps/dashboard/src/shared/lib/db/schema.ts` (수정) | `stock_timeframe_analyses` 테이블 append |
| `apps/dashboard/src/entities/stock-timeframe/model/types.ts` (생성) | tickerlens 타입 re-export + DB row 타입 |
| `apps/dashboard/src/entities/stock-timeframe/server.ts` (생성) | server-only: 이력 insert/list/getById (Drizzle) |
| `apps/dashboard/src/entities/stock-timeframe/client.ts` (생성) | client barrel: 타입 + UI re-export |
| `apps/dashboard/src/entities/stock-timeframe/ui/SignalBadge.tsx` (생성) | tickerlens Signal 색상 뱃지 |
| `apps/dashboard/src/entities/stock-timeframe/ui/PerspectiveCell.tsx` (생성) | 단일 (페르소나×타임프레임) 셀 |
| `apps/dashboard/src/entities/stock-timeframe/ui/PerspectiveGrid.tsx` (생성) | 페르소나×타임프레임 그리드 |
| `apps/dashboard/src/entities/stock-timeframe/ui/SnapshotCard.tsx` (생성) | TickerSnapshot 표시 |
| `apps/dashboard/src/features/stock-timeframe-analyze/lib/tickerlens-adapter.ts` (생성) | gons env → tickerlens ModelConfigAdapter |
| `apps/dashboard/src/features/stock-timeframe-analyze/api/analyzeTimeframe.ts` (생성) | server action: 분석 트리거 + 이력 저장 |
| `apps/dashboard/src/features/stock-timeframe-analyze/model/schema.ts` (생성) | US 티커 입력 Zod 스키마 |
| `apps/dashboard/src/features/stock-timeframe-analyze/ui/TickerInput.tsx` (생성) | US 티커 입력 컴포넌트 |
| `apps/dashboard/src/widgets/stock-timeframe/StocksView.tsx` (생성) | client container: 입력+그리드+이력 조합 |
| `apps/dashboard/src/widgets/stock-timeframe/HistoryPanel.tsx` (생성) | 이력 목록/선택 |
| `apps/dashboard/src/app/stocks/page.tsx` (생성) | RSC, auth guard, StocksView 렌더 |
| `apps/dashboard/src/app/api/stock/timeframe/[id]/route.ts` (생성) | 이력 단건 조회 |
| `apps/dashboard/src/app/page.tsx` (수정) | 루트 대시보드 위젯 그리드에 `/stocks` next/link 추가 |

**ai-signalcraft 제거 (원본):**

| 파일 | 처리 |
|---|---|
| stocks 커밋 `5600667^..HEAD` (8개) | `git revert` 또는 수동 제거 |
| `stock_analyses` 테이블 | drop 마이그레이션 (사용자 확인 필요 — Task 15) |

---

## Phase A — gons-dashboard 이식

### Task 1: tickerlens 의존성 추가

**Files:**
- Modify: `apps/dashboard/package.json` (dependencies, `@krdn/*` 줄 근처)

- [ ] **Step 1: package.json dependencies에 tickerlens 추가**

`@krdn/saju` / `@krdn/llm-gateway` 줄 근처에 추가:

```json
    "@krdn/saju": "github:krdn/saju#v1.2.2",
    "@krdn/tickerlens": "github:krdn/tickerlens#v0.1.0",
    "@krdn/llm-gateway": "github:krdn/llm-gateway#v3.2.0",
```

- [ ] **Step 2: 설치 및 resolve 확인**

Run: `cd /home/gon/projects/gon/gons-dashboard && pnpm install`
Expected: `@krdn/tickerlens` 설치 성공.

검증: `ls apps/dashboard/node_modules/@krdn/tickerlens/dist/index.d.ts` → 파일 존재.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "chore: @krdn/tickerlens 의존성 추가 (타임프레임 분석)"
```

---

### Task 1.5: next.config — tickerlens/yahoo-finance2 외부화 [차단]

**Files:**
- Modify: `apps/dashboard/next.config.ts` (`serverExternalPackages` 배열)

> **이유:** tickerlens의 기본 데이터 어댑터가 `yahoo-finance2`(Node-only)를 쓴다. 외부화하지 않으면 server 번들링 시 빌드/렌더가 깨진다 (ai-signalcraft 커밋 `019d247`이 정확히 이 이유로 추가). gons next.config에는 이미 `@krdn/llm-gateway`만 있고 tickerlens/yahoo는 없다.

- [ ] **Step 1: serverExternalPackages에 추가**

```typescript
  serverExternalPackages: ["postgres", "tree-sitter-bash", "web-tree-sitter", "@lydell/node-pty-linux-x64", "@krdn/llm-gateway", "@krdn/tickerlens", "yahoo-finance2"],
```

- [ ] **Step 2: 빌드 확인** — Run: `cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm build` (또는 Task 13에서 최종 확인). Expected: 외부화 관련 경고 없음.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/next.config.ts
git commit -m "chore: tickerlens/yahoo-finance2 serverExternalPackages 추가"
```

---

### Task 2: DB 스키마 — stock_timeframe_analyses 테이블

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` (stock 도메인 테이블 끝, `stock_symbol_migrations` 정의 뒤에 append)

- [ ] **Step 1: 테이블 정의 추가**

schema.ts 상단 import에 `uuid`, `text`, `timestamp`, `jsonb`, `numeric`가 있는지 확인(`portfolio_holdings`가 이미 사용하므로 존재). stock 도메인 테이블 마지막 뒤에 추가:

```typescript
// 주식 타임프레임 분석 이력 (@krdn/tickerlens — 페르소나×타임프레임, 집계 없음)
// 기존 stock_analysis_cache(페르소나×verdict+consensus)와 별개 도메인.
export const stockTimeframeAnalyses = pgTable("stock_timeframe_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  depth: text("depth").notNull(), // 'full' | 'lite'
  asOf: timestamp("as_of").notNull(),
  result: jsonb("result").notNull(), // tickerlens AnalysisResult 전체
  costUsd: numeric("cost_usd"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

> 주의: `users` 참조 식별자가 schema.ts의 실제 export명인지 확인 — `portfolio_holdings` 정의의 `references(() => users.id ...)` 패턴과 동일 식별자 사용.

- [ ] **Step 2: 마이그레이션 생성**

Run: `cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm db:generate`
Expected: `apps/dashboard/drizzle/`에 `CREATE TABLE "stock_timeframe_analyses"` 포함 SQL 생성.

검증: `grep -rl "stock_timeframe_analyses" apps/dashboard/drizzle/`

- [ ] **Step 3: 마이그레이션 적용**

Run: `pnpm db:migrate`
Expected: 적용 성공.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(db): stock_timeframe_analyses 테이블 추가"
```

---

### Task 3: stock-timeframe entity — model/types.ts

**Files:**
- Create: `apps/dashboard/src/entities/stock-timeframe/model/types.ts`

- [ ] **Step 1: 타입 정의 작성**

```typescript
import type { InferSelectModel } from "drizzle-orm";
import type { stockTimeframeAnalyses } from "@/shared/lib/db/schema";
// tickerlens public 타입 re-export — 분석 모델의 단일 소스
export type {
  AnalysisResult,
  PerspectiveResult,
  PersonaSlots,
  PerspectiveSlot,
  TickerSnapshot,
  Persona,
  Timeframe,
  Signal,
  Evidence,
} from "@krdn/tickerlens";

export type StockTimeframeAnalysisRow = InferSelectModel<typeof stockTimeframeAnalyses>;

// 이력 목록 표시용 경량 타입 (result jsonb 제외)
export interface TimeframeHistoryItem {
  id: string;
  ticker: string;
  depth: string;
  asOf: Date;
  createdAt: Date;
}

export const PERSONAS = ["value", "growth", "quant", "options"] as const;
export const TIMEFRAMES = ["long", "mid", "short"] as const;
export const PERSONA_LABEL: Record<string, string> = {
  value: "가치",
  growth: "성장",
  quant: "퀀트",
  options: "옵션",
};
export const TIMEFRAME_LABEL: Record<string, string> = {
  long: "장기",
  mid: "중기",
  short: "단기",
};
```

- [ ] **Step 2: 타입체크** — Run: `cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm tsc --noEmit` → 이 파일 관련 에러 없음.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/entities/stock-timeframe/model/types.ts
git commit -m "feat(entities): stock-timeframe model 타입 추가"
```

---

### Task 4: stock-timeframe entity — server.ts (이력 데이터 접근)

**Files:**
- Create: `apps/dashboard/src/entities/stock-timeframe/server.ts`

- [ ] **Step 1: server-only 데이터 접근 함수 작성**

```typescript
import "server-only";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockTimeframeAnalyses } from "@/shared/lib/db/schema";
import type { AnalysisResult, TimeframeHistoryItem, StockTimeframeAnalysisRow } from "./model/types";

export async function insertTimeframeAnalysis(args: {
  userId: string;
  ticker: string;
  depth: "full" | "lite";
  result: AnalysisResult;
  costUsd: number | null;
}): Promise<string> {
  const [row] = await db
    .insert(stockTimeframeAnalyses)
    .values({
      userId: args.userId,
      ticker: args.ticker,
      depth: args.depth,
      asOf: new Date(args.result.asOf),
      result: args.result,
      costUsd: args.costUsd != null ? String(args.costUsd) : null,
    })
    .returning({ id: stockTimeframeAnalyses.id });
  return row.id;
}

// 사용자 격리: 본인 이력만 조회
export async function listTimeframeAnalyses(
  userId: string,
  limit = 20,
): Promise<TimeframeHistoryItem[]> {
  const rows = await db
    .select({
      id: stockTimeframeAnalyses.id,
      ticker: stockTimeframeAnalyses.ticker,
      depth: stockTimeframeAnalyses.depth,
      asOf: stockTimeframeAnalyses.asOf,
      createdAt: stockTimeframeAnalyses.createdAt,
    })
    .from(stockTimeframeAnalyses)
    .where(eq(stockTimeframeAnalyses.userId, userId))
    .orderBy(desc(stockTimeframeAnalyses.createdAt))
    .limit(limit);
  return rows;
}

export async function getTimeframeAnalysisById(
  userId: string,
  id: string,
): Promise<StockTimeframeAnalysisRow | null> {
  const [row] = await db
    .select()
    .from(stockTimeframeAnalyses)
    .where(and(eq(stockTimeframeAnalyses.id, id), eq(stockTimeframeAnalyses.userId, userId)))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 2: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/entities/stock-timeframe/server.ts
git commit -m "feat(entities): stock-timeframe 이력 데이터 접근 (server-only)"
```

---

### Task 5: stock-timeframe entity — UI (SignalBadge)

**Files:**
- Create: `apps/dashboard/src/entities/stock-timeframe/ui/SignalBadge.tsx`

- [ ] **Step 1: 작성**

```tsx
import type { Signal } from "../model/types";

const SIGNAL_LABEL: Record<Signal, string> = {
  strong_buy: "적극 매수",
  buy: "매수",
  hold: "보유",
  sell: "매도",
  strong_sell: "적극 매도",
};

const SIGNAL_COLOR: Record<Signal, string> = {
  strong_buy: "bg-green-100 text-green-800",
  buy: "bg-emerald-50 text-emerald-700",
  hold: "bg-slate-100 text-slate-600",
  sell: "bg-orange-50 text-orange-700",
  strong_sell: "bg-red-100 text-red-800",
};

export function SignalBadge({ signal, confidence }: { signal: Signal; confidence?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${SIGNAL_COLOR[signal]}`}
    >
      {SIGNAL_LABEL[signal]}
      {confidence != null && <span className="opacity-60">{confidence}%</span>}
    </span>
  );
}
```

- [ ] **Step 2: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/entities/stock-timeframe/ui/SignalBadge.tsx
git commit -m "feat(entities): stock-timeframe SignalBadge"
```

---

### Task 6: stock-timeframe entity — UI (PerspectiveCell + PerspectiveGrid)

**Files:**
- Create: `apps/dashboard/src/entities/stock-timeframe/ui/PerspectiveCell.tsx`
- Create: `apps/dashboard/src/entities/stock-timeframe/ui/PerspectiveGrid.tsx`

- [ ] **Step 1: PerspectiveCell 작성** (단일 슬롯 = `PerspectiveSlot = Result<PerspectiveResult>`)

```tsx
import type { PerspectiveSlot } from "../model/types";
import { SignalBadge } from "./SignalBadge";

export function PerspectiveCell({ slot }: { slot: PerspectiveSlot }) {
  if (!slot.ok) {
    return (
      <div className="rounded border border-dashed border-slate-200 p-2 text-xs text-slate-400">
        분석 실패
      </div>
    );
  }
  const p = slot.value;
  return (
    <div className="space-y-1 rounded border border-slate-200 p-2">
      <SignalBadge signal={p.signal} confidence={p.confidence} />
      <p className="line-clamp-3 text-xs text-slate-600">{p.thesis}</p>
    </div>
  );
}
```

- [ ] **Step 2: PerspectiveGrid 작성** (페르소나 4행 × 타임프레임 3열)

```tsx
import type { AnalysisResult } from "../model/types";
import { PERSONAS, TIMEFRAMES, PERSONA_LABEL, TIMEFRAME_LABEL } from "../model/types";
import { PerspectiveCell } from "./PerspectiveCell";

export function PerspectiveGrid({ result }: { result: AnalysisResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="p-2 text-left text-xs text-slate-400">페르소나 \ 기간</th>
            {TIMEFRAMES.map((tf) => (
              <th key={tf} className="p-2 text-left text-xs font-semibold text-slate-500">
                {TIMEFRAME_LABEL[tf]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERSONAS.map((persona) => (
            <tr key={persona}>
              <td className="p-2 align-top text-xs font-semibold text-slate-700">
                {PERSONA_LABEL[persona]}
              </td>
              {TIMEFRAMES.map((tf) => (
                <td key={tf} className="p-2 align-top">
                  <PerspectiveCell slot={result.perspectives[persona][tf]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음. (`result.perspectives[persona][tf]` 인덱싱이 `PersonaSlots`/`PerspectiveSlot`과 맞는지 확인)
- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/entities/stock-timeframe/ui/PerspectiveCell.tsx apps/dashboard/src/entities/stock-timeframe/ui/PerspectiveGrid.tsx
git commit -m "feat(entities): stock-timeframe PerspectiveGrid + Cell"
```

---

### Task 7: stock-timeframe entity — UI (SnapshotCard) + client barrel

**Files:**
- Create: `apps/dashboard/src/entities/stock-timeframe/ui/SnapshotCard.tsx`
- Create: `apps/dashboard/src/entities/stock-timeframe/client.ts`

- [ ] **Step 1: SnapshotCard 작성**

```tsx
import type { TickerSnapshot } from "../model/types";

export function SnapshotCard({ snapshot }: { snapshot: TickerSnapshot }) {
  const { price, fundamentals } = snapshot;
  return (
    <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 p-3 text-sm sm:grid-cols-4">
      <div>
        <p className="text-xs text-slate-400">현재가</p>
        <p className="font-semibold">${price.last.toFixed(2)}</p>
        <p className={price.changePct >= 0 ? "text-green-600" : "text-red-600"}>
          {price.changePct >= 0 ? "+" : ""}
          {price.changePct.toFixed(2)}%
        </p>
      </div>
      <div>
        <p className="text-xs text-slate-400">시총</p>
        <p className="font-semibold">${(fundamentals.marketCap / 1e9).toFixed(1)}B</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">PER</p>
        <p className="font-semibold">{fundamentals.pe?.toFixed(1) ?? "—"}</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">PBR</p>
        <p className="font-semibold">{fundamentals.pb?.toFixed(2) ?? "—"}</p>
      </div>
      {snapshot.warnings.length > 0 && (
        <p className="col-span-full text-xs text-amber-600">⚠ {snapshot.warnings.join(", ")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: client barrel 작성** (server-only import 금지 — 타입 + UI만)

```typescript
// client-safe 진입점 — server.ts(Drizzle/Node)를 import하지 않는다.
export * from "./model/types";
export { SignalBadge } from "./ui/SignalBadge";
export { PerspectiveCell } from "./ui/PerspectiveCell";
export { PerspectiveGrid } from "./ui/PerspectiveGrid";
export { SnapshotCard } from "./ui/SnapshotCard";
```

- [ ] **Step 3: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음.
- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/entities/stock-timeframe/ui/SnapshotCard.tsx apps/dashboard/src/entities/stock-timeframe/client.ts
git commit -m "feat(entities): stock-timeframe SnapshotCard + client barrel"
```

---

### Task 8: feature — tickerlens ModelConfigAdapter (gons env 연결)

**Files:**
- Create: `apps/dashboard/src/features/stock-timeframe-analyze/lib/tickerlens-adapter.ts`

- [ ] **Step 1: 작성** (gons 프록시 env → tickerlens ModelConfigAdapter)

```typescript
import "server-only";
import type { ModelConfigAdapter } from "@krdn/llm-gateway/adapters";
import { env } from "@/shared/config/env";

// gons는 ANTHROPIC_BASE_URL(:8317 프록시) + ANTHROPIC_API_KEY로 모든 LLM을 라우팅한다.
// 모듈 이름과 무관하게 단일 provider/model로 16개 tickerlens 모듈 전부 처리 (per-persona 튜닝 YAGNI).
export function buildTickerlensModelConfig(): ModelConfigAdapter {
  return {
    async resolve(_moduleName: string) {
      return {
        provider: "anthropic" as const, // AIProvider 리터럴로 좁힘
        model: env.SAJU_LLM_MODEL_CLAUDE,
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: env.ANTHROPIC_BASE_URL,
      };
    },
  };
}
```

- [ ] **Step 2: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음. (`resolve` 반환의 `provider`가 `AIProvider` 리터럴과 맞는지)
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/stock-timeframe-analyze/lib/tickerlens-adapter.ts
git commit -m "feat(features): tickerlens ModelConfigAdapter (gons 프록시 env)"
```

---

### Task 9: feature — 입력 스키마 + 분석 server action

**Files:**
- Create: `apps/dashboard/src/features/stock-timeframe-analyze/model/schema.ts`
- Create: `apps/dashboard/src/features/stock-timeframe-analyze/api/analyzeTimeframe.ts`

- [ ] **Step 1: 입력 스키마 작성** (US 티커 전용)

```typescript
import { z } from "zod";

export const AnalyzeTimeframeSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z.-]+$/, "티커는 영문/마침표/하이픈만 허용됩니다"),
  depth: z.enum(["full", "lite"]).default("lite"),
});

export type AnalyzeTimeframeInput = z.infer<typeof AnalyzeTimeframeSchema>;
```

- [ ] **Step 2: server action 작성** (gons addHolding 패턴: auth → safeParse → 분석 → insert → revalidate)

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { composeTickerAnalysis } from "@krdn/tickerlens";
import { auth } from "@/shared/lib/auth";
import { insertTimeframeAnalysis } from "@/entities/stock-timeframe/server";
import { buildTickerlensModelConfig } from "../lib/tickerlens-adapter";
import { AnalyzeTimeframeSchema, type AnalyzeTimeframeInput } from "../model/schema";
import type { AnalysisResult } from "@/entities/stock-timeframe/model/types";

export interface AnalyzeTimeframeResult {
  success: boolean;
  error?: string;
  id?: string;
  result?: AnalysisResult;
}

export async function analyzeTimeframe(
  input: AnalyzeTimeframeInput,
): Promise<AnalyzeTimeframeResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = AnalyzeTimeframeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "검증 실패" };
  }
  const ticker = parsed.data.ticker.toUpperCase();
  const depth = parsed.data.depth;

  let result: AnalysisResult;
  try {
    result = await composeTickerAnalysis(ticker, {
      configAdapter: buildTickerlensModelConfig(),
      depth,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "분석 호출 실패";
    return { success: false, error: msg };
  }

  if (result.meta.completed === 0) {
    return {
      success: false,
      error: `${ticker} 분석에 실패했습니다 (모든 관점 실패). 잠시 후 다시 시도하세요.`,
    };
  }

  const id = await insertTimeframeAnalysis({
    userId: session.user.id,
    ticker,
    depth,
    result,
    costUsd: result.meta.totalCostUsd ?? null,
  });

  revalidatePath("/stocks");
  return { success: true, id, result };
}
```

- [ ] **Step 3: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음.
- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/stock-timeframe-analyze/model/schema.ts apps/dashboard/src/features/stock-timeframe-analyze/api/analyzeTimeframe.ts
git commit -m "feat(features): stock-timeframe 분석 server action + 입력 스키마"
```

---

### Task 10: feature — TickerInput UI

**Files:**
- Create: `apps/dashboard/src/features/stock-timeframe-analyze/ui/TickerInput.tsx`

> **v1 결정 (full=12콜 hang 회피):** server action이 동기 await이므로 full(12콜)을 고르면 수십 초 hang/timeout이 발생한다 (조사 `portChallenges[0]` 경고 + 원래 "동작 안 함" 버그의 변주). v1은 **lite(4콜) 단일 경로**로 확정하고 동작하지 않는 full 라디오는 두지 않는다. depth 토글 UI 자체를 제거하고 항상 `lite`로 호출 — 추후 폴링 아키텍처가 들어오면 full 토글을 재도입한다.

- [ ] **Step 1: 작성** (native button — 공용 button 의존 제거, depth=lite 고정)

```tsx
"use client";

import { useState } from "react";

interface TickerInputProps {
  onAnalyze: (ticker: string) => void;
  isLoading: boolean;
}

export function TickerInput({ onAnalyze, isLoading }: TickerInputProps) {
  const [ticker, setTicker] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="US 티커 (예: AAPL)"
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          maxLength={10}
        />
        <button
          type="button"
          onClick={() => onAnalyze(ticker.trim())}
          disabled={isLoading || !ticker.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? "분석 중…" : "분석"}
        </button>
      </div>
      <p className="text-xs text-slate-400">빠른 분석 (페르소나당 1회, 총 4회 LLM 호출)</p>
    </div>
  );
}
```

> Task 11의 StocksView는 `onAnalyze={(ticker) => handleAnalyze(ticker)}`로 받고 `analyzeTimeframe({ ticker, depth: "lite" })`로 호출한다 (depth 인자 제거).

- [ ] **Step 2: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/stock-timeframe-analyze/ui/TickerInput.tsx
git commit -m "feat(features): stock-timeframe TickerInput (US 전용)"
```

---

### Task 11: widget — HistoryPanel + StocksView (조합 컨테이너)

**Files:**
- Create: `apps/dashboard/src/widgets/stock-timeframe/HistoryPanel.tsx`
- Create: `apps/dashboard/src/widgets/stock-timeframe/StocksView.tsx`

- [ ] **Step 1: HistoryPanel 작성**

```tsx
"use client";

import type { TimeframeHistoryItem } from "@/entities/stock-timeframe/client";

export function HistoryPanel({
  items,
  onSelect,
  selectedId,
}: {
  items: TimeframeHistoryItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-400">분석 이력이 없습니다</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50 ${
              item.id === selectedId ? "bg-blue-50 text-blue-700" : "text-slate-600"
            }`}
          >
            <span className="font-medium">{item.ticker}</span>
            <span className="ml-2 text-slate-400">{item.depth}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: StocksView 작성** (client container)

```tsx
"use client";

import { useState } from "react";
import {
  PerspectiveGrid,
  SnapshotCard,
  type AnalysisResult,
  type TimeframeHistoryItem,
} from "@/entities/stock-timeframe/client";
import { TickerInput } from "@/features/stock-timeframe-analyze/ui/TickerInput";
import { analyzeTimeframe } from "@/features/stock-timeframe-analyze/api/analyzeTimeframe";
import { HistoryPanel } from "./HistoryPanel";

export function StocksView({ initialHistory }: { initialHistory: TimeframeHistoryItem[] }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(ticker: string) {
    setIsLoading(true);
    setError(null);
    const res = await analyzeTimeframe({ ticker, depth: "lite" });
    setIsLoading(false);
    if (!res.success || !res.result) {
      setError(res.error ?? "분석 실패");
      return;
    }
    setResult(res.result);
    setSelectedId(res.id ?? null);
    setHistory((prev) => [
      {
        id: res.id!,
        ticker: ticker.toUpperCase(),
        depth: "lite",
        asOf: new Date(res.result!.asOf),
        createdAt: new Date(),
      },
      ...prev,
    ]);
  }

  async function handleSelect(id: string) {
    setSelectedId(id);
    setError(null);
    const r = await fetch(`/api/stock/timeframe/${id}`);
    if (!r.ok) {
      setError("이력을 불러오지 못했습니다");
      return;
    }
    const data = (await r.json()) as { result: AnalysisResult };
    setResult(data.result);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="space-y-4">
        <TickerInput onAnalyze={(ticker) => handleAnalyze(ticker)} isLoading={isLoading} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <>
            <SnapshotCard snapshot={result.snapshot} />
            <PerspectiveGrid result={result} />
          </>
        )}
      </div>
      <aside className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">이력</h2>
        <HistoryPanel items={history} onSelect={handleSelect} selectedId={selectedId} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음.
- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/stock-timeframe/
git commit -m "feat(widgets): stock-timeframe StocksView + HistoryPanel"
```

---

### Task 12: API route — 이력 단건 조회 (getById)

**Files:**
- Create: `apps/dashboard/src/app/api/stock/timeframe/[id]/route.ts`

- [ ] **Step 1: 작성** (gons API route 패턴: auth guard + server-only 조회)

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { getTimeframeAnalysisById } from "@/entities/stock-timeframe/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const row = await getTimeframeAnalysisById(session.user.id, id);
  if (!row) {
    return NextResponse.json({ error: "분석 이력을 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ result: row.result });
}
```

> 주의: Next.js 16에서 `params`는 Promise. 기존 gons 동적 라우트(`app/api/stock/.../[*]/route.ts`)를 grep해 동일 시그니처인지 대조.

- [ ] **Step 2: 타입체크** — Run: `pnpm tsc --noEmit` → 에러 없음.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/api/stock/timeframe/
git commit -m "feat(api): stock-timeframe 이력 단건 조회 라우트"
```

---

### Task 13: app/stocks 페이지 (RSC) + 루트 네비 링크

**Files:**
- Create: `apps/dashboard/src/app/stocks/page.tsx`
- Modify: `apps/dashboard/src/app/page.tsx` (위젯 그리드에 `/stocks` 링크 추가)

- [ ] **Step 1: app/page.tsx의 auth guard 패턴 확인 후 app/stocks/page.tsx 작성**

> 먼저 `app/page.tsx`를 Read해 정확한 auth→redirect 코드를 복사.

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { listTimeframeAnalyses } from "@/entities/stock-timeframe/server";
import { StocksView } from "@/widgets/stock-timeframe/StocksView";

export const dynamic = "force-dynamic";

export default async function StocksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const history = await listTimeframeAnalyses(session.user.id);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">주식 타임프레임 분석</h1>
        <p className="mt-1 text-sm text-slate-500">
          US 티커를 페르소나 × 장/중/단기 관점으로 분석합니다 (powered by tickerlens)
        </p>
      </div>
      <StocksView initialHistory={history} />
    </main>
  );
}
```

- [ ] **Step 2: 루트 대시보드(app/page.tsx)에 `/stocks` 링크 추가**

> `app/page.tsx`의 기존 위젯/카드가 `next/link`로 `/servers`·`/fortune`로 가는 패턴을 찾아 동일 스타일로 추가. 예시:

```tsx
import Link from "next/link";
// ... 기존 위젯 그리드 안에:
<Link
  href="/stocks"
  className="rounded-lg border border-slate-200 p-4 hover:border-blue-300 hover:bg-slate-50"
>
  <h3 className="font-semibold text-slate-900">주식 타임프레임 분석</h3>
  <p className="mt-1 text-sm text-slate-500">US 티커 페르소나×기간 분석</p>
</Link>
```

- [ ] **Step 3: 타입체크 + 빌드** — Run: `pnpm tsc --noEmit && pnpm build`
Expected: 빌드 성공. 검증: `ls apps/dashboard/.next/server/app/ | grep stocks`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/stocks/ apps/dashboard/src/app/page.tsx
git commit -m "feat(app): /stocks 타임프레임 분석 페이지 + 루트 네비 링크"
```

---

### Task 14: 실제 렌더 검증 (E2E)

**Files:** (없음 — 런타임 검증)

- [ ] **Step 1: dev :3020에서 로그인 후 /stocks 렌더 확인**

1. `http://localhost:3020/login` 로그인
2. `http://localhost:3020/stocks` → 페이지 렌더 (TickerInput + 이력 패널)
3. `AAPL` + 빠른 분석(lite) → SnapshotCard + PerspectiveGrid(4×3) 렌더
4. dev 서버 로그에 server-side throw 없음 확인

Expected: 200 렌더, 그리드에 페르소나×타임프레임 Signal 표시.

- [ ] **Step 2: 루트(/) 에서 /stocks 링크 노출·이동 확인**

---

## Phase B — ai-signalcraft 원본 제거

### Task 15: [사용자 확인 필요] DB 테이블 처리 방침

- [ ] **Step 1: `stock_analyses` 테이블 처리 확인**

(A) drop 마이그레이션으로 실제 제거(데이터 삭제) / (B) 코드만 제거하고 테이블 보존(orphan).
> 적용된 마이그레이션 되돌림은 비가역적이므로 실행 전 확인.

---

### Task 16: ai-signalcraft stocks 코드 제거

**Files (제거):**
- `apps/web/src/app/stocks/page.tsx`
- `apps/web/src/components/stocks/` (전체)
- `apps/web/src/server/trpc/routers/stocks.ts` + `__tests__/stocks.test.ts`
- `packages/core/src/analysis/stocks/` (전체)
- `packages/core/src/db/schema/stocks.ts` (Task 15 (A) 시 drop 마이그레이션 동반)

**Files (수정 — orphan 정리):**
- `apps/web/src/server/trpc/router.ts` (stocksRouter 등록 해제)
- `apps/web/src/components/layout/app-sidebar.tsx` (277~283 "주식 분석" 링크 + 미사용 시 `CandlestickChart` import 제거)
- `apps/web/next.config.ts` (serverExternalPackages에서 `@krdn/tickerlens`, `yahoo-finance2` 제거)
- `packages/core/src/index.ts` (analyzeTicker/stockAnalyses export 제거)
- `packages/core/package.json` (`@krdn/tickerlens` 의존성 제거)

- [ ] **Step 1: git revert 가능성 확인**

```bash
cd /home/gon/projects/ai/ai-signalcraft
git log --oneline 5600667~1..HEAD
```
> stocks 무관 변경이 섞였는지 확인. 안 섞였으면 `git revert --no-commit 5600667..HEAD` 후 단일 커밋. 섞였으면 Step 2 수동 제거.

- [ ] **Step 2: (revert 불가 시) 수동 제거** — 위 목록대로 삭제·수정.

`app-sidebar.tsx` 제거 블록:
```tsx
          <Link href="/stocks" className="...">
            <CandlestickChart className="h-3.5 w-3.5" />
            주식 분석
          </Link>
```

- [ ] **Step 3: (Task 15 (A) 시) drop 마이그레이션 생성·적용**

- [ ] **Step 4: 빌드 + 테스트로 orphan 없음 확인**

Run: `cd /home/gon/projects/ai/ai-signalcraft && pnpm build && pnpm test`
검증: `grep -rn "stocks\|tickerlens\|analyzeTicker" apps/web/src packages/core/src --include="*.ts" --include="*.tsx" | grep -v node_modules` → 잔여 참조 없음.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "revert: 잘못 추가된 stocks(tickerlens) 기능 제거 — gons-dashboard로 이전됨"
```

---

## Self-Review 체크리스트

- [ ] gons /stocks 페이지가 :3020에서 로그인 후 실제 렌더 (307/라우트 존재가 아닌 실제 콘텐츠)
- [ ] gons `pnpm tsc --noEmit && pnpm build` 통과
- [ ] gons 분석 1회(AAPL lite) → 그리드 + 이력 저장 동작
- [ ] ai-signalcraft `pnpm build && pnpm test` 통과 (orphan 없음)
- [ ] ai-signalcraft stocks 잔여 참조 0 (grep)
- [ ] server-only seam: client.ts가 server.ts를 import하지 않음
- [ ] 사용자 격리: list/getById가 userId 필터 적용

## 실행 중 확인할 점 (코드 작성 시 검증)

- `users` 테이블 export 식별자명 (Task 2) — `portfolio_holdings`의 실제 참조명 확인.
- tickerlens `ModelConfigAdapter.resolve` 반환 형태가 실제 타입과 일치 (Task 8) — `@krdn/llm-gateway/adapters` 타입 대조.
- Next.js 16 동적 라우트 `params: Promise<{id}>` 시그니처 (Task 12) — 기존 gons 동적 라우트와 대조.
- ai-signalcraft drizzle 마이그레이션 도구/디렉토리 (Task 16 Step 3).
