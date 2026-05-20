# Phase 1: Scaffold + Schema

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** `packages/stock-analysis` 패키지 부트스트랩, Drizzle 4 테이블 추가, entities barrel server/client 분리.

**완료 조건:** `pnpm typecheck && pnpm lint` 모두 PASS, 로컬 migration SQL 생성 완료 (운영 적용은 Phase 8).

---

## Task 1.1: packages/stock-analysis 패키지 부트스트랩

**Files:**
- Create: `packages/stock-analysis/package.json`
- Create: `packages/stock-analysis/tsconfig.json`
- Create: `packages/stock-analysis/src/index.ts`

- [ ] **Step 1: package.json 작성 (saju 미러)**

```json
{
  "name": "@gons/stock-analysis",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsx": "^4.19.2",
    "typescript": "^5",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {},
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "**/*.tsbuildinfo"]
}
```

- [ ] **Step 3: src/index.ts 빈 barrel**

```ts
// Public API for @gons/stock-analysis package.
// Yahoo adapter, 5 페르소나 prompt builder, consensus builder.
export {};
```

- [ ] **Step 4: pnpm install 로 workspace 인식**

Run: `pnpm install`
Expected: 출력에 `+ @gons/stock-analysis` 가 보여야 함.

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @gons/stock-analysis typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/stock-analysis pnpm-lock.yaml
git commit -m "feat(stock-analysis): @gons/stock-analysis 패키지 부트스트랩"
```

---

## Task 1.2: dashboard 가 새 패키지 인식 + Dockerfile 패치

**Files:**
- Modify: `apps/dashboard/package.json` (dependencies)
- Modify: `apps/dashboard/Dockerfile` (build/prod 두 stage 모두)

⚠️ **Gotcha:** `workspace-package-dockerfile-gotcha` — PR CI 는 통과해도 main Docker 빌드만 module-not-found 로 조용히 실패. 두 stage 모두 패치 필수.

- [ ] **Step 1: dependencies 에 `@gons/stock-analysis` 추가**

기존 `"@gons/saju": "workspace:*"` 다음 줄에:
```json
"@gons/stock-analysis": "workspace:*",
```

- [ ] **Step 2: pnpm install 재실행**

Run: `pnpm install`
Expected: dashboard 의 node_modules 에 symlink 생김.

- [ ] **Step 3: Dockerfile 두 stage 패치**

`apps/dashboard/Dockerfile` 안의 `COPY packages/saju ./packages/saju/` 다음 줄에 (build stage 와 prod stage 두 곳 모두):
```dockerfile
COPY packages/stock-analysis ./packages/stock-analysis/
```

- [ ] **Step 4: 로컬 빌드 검증**

Run: `pnpm --filter @gons/dashboard build`
Expected: build success. "Cannot find module '@gons/stock-analysis'" 없어야 함.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/Dockerfile pnpm-lock.yaml
git commit -m "feat(stock-analysis): dashboard 가 @gons/stock-analysis 의존성으로 인식"
```

---

## Task 1.3: Drizzle 4 테이블 + CHECK 제약

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` (말미에 4 테이블)
- Create: `apps/dashboard/drizzle/00XX_stock_checks.sql` (raw CHECK)

- [ ] **Step 1: schema.ts 말미에 portfolioHoldings 추가**

```ts
// stock-analysis 위젯
export const portfolioHoldings = pgTable(
  "portfolio_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class").notNull(),
    market: text("market").notNull(),
    displayName: text("display_name").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    avgCost: numeric("avg_cost", { precision: 20, scale: 8 }).notNull(),
    purchasedAt: date("purchased_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userSymbolUq: uniqueIndex("portfolio_holdings_user_symbol_uq").on(t.userId, t.symbol),
    userIdx: index("portfolio_holdings_user_idx").on(t.userId),
  }),
);
```

- [ ] **Step 2: stockPersonaPreferences 추가**

```ts
export const stockPersonaPreferences = pgTable("stock_persona_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  overrides: jsonb("overrides")
    .$type<Record<string, "claude" | "codex" | "gemini">>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 3: stockAnalysisCache 추가**

```ts
export const stockAnalysisCache = pgTable(
  "stock_analysis_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: text("symbol").notNull(),
    analysisDate: date("analysis_date").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    personas: jsonb("personas").notNull(),
    consensus: jsonb("consensus").notNull(),
    marketSnapshot: jsonb("market_snapshot").notNull(),
    promptVersion: text("prompt_version").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    lookupUq: uniqueIndex("stock_cache_lookup_uq").on(t.symbol, t.analysisDate, t.userId),
    lookupIdx: index("stock_cache_lookup_idx").on(t.userId, t.symbol, t.analysisDate),
  }),
);
```

- [ ] **Step 4: stockConsensusFlips 추가**

```ts
export const stockConsensusFlips = pgTable(
  "stock_consensus_flips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    fromVerdict: text("from_verdict").notNull(),
    toVerdict: text("to_verdict").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index("flips_pending_idx").on(t.notifiedAt).where(sql`${t.notifiedAt} IS NULL`),
  }),
);
```

- [ ] **Step 5: drizzle-kit generate**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: `apps/dashboard/drizzle/00XX_<name>.sql` 신규 — 4 CREATE TABLE + 인덱스 정의.

⚠️ snapshot id collision 시 메모리 `drizzle-snapshot-id-collision` 참조 — `id`/`prevId` 두 줄만 수정.

- [ ] **Step 6: 생성된 SQL 시각 검증**

Run: `cat apps/dashboard/drizzle/00*_*.sql | tail -100`
Expected: 4 CREATE TABLE + 4 인덱스 + UNIQUE 제약 모두 출현.

- [ ] **Step 7: CHECK 제약 raw SQL 마이그레이션 추가**

Drizzle Kit 자동 생성 못 함:

```sql
-- apps/dashboard/drizzle/00XX_stock_checks.sql (직전 마이그레이션 +1)
ALTER TABLE portfolio_holdings
  ADD CONSTRAINT portfolio_holdings_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT portfolio_holdings_avg_cost_nonnegative CHECK (avg_cost >= 0);
```

`apps/dashboard/drizzle/meta/_journal.json` 에 entry 수동 추가:
```json
{
  "idx": <직전 +1>,
  "version": "7",
  "when": <Date.now()>,
  "tag": "00XX_stock_checks",
  "breakpoints": true
}
```

- [ ] **Step 8: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(stock-analysis): Drizzle 4 테이블 + CHECK 제약"
```

---

## Task 1.4: entities/stock 스켈레톤 (server/client 분리)

**Files:**
- Create: `apps/dashboard/src/entities/stock/model/quote-types.ts`
- Create: `apps/dashboard/src/entities/stock/server.ts`
- Create: `apps/dashboard/src/entities/stock/client.ts`

⚠️ **CLAUDE.md Gotcha #1:** entity 의 server/client 진입점 분리. server.ts 는 `import "server-only"`, client.ts 는 types-only.

- [ ] **Step 1: model/quote-types.ts**

```ts
export type AssetClass = "stock" | "crypto" | "commodity";
export type Market = "NASDAQ" | "NYSE" | "KRX" | "CRYPTO" | "COMMODITY";

export interface Quote {
  symbol: string;
  price: number;
  changePct: number;
  currency: string;
  fetchedAt: string; // ISO 8601
}

export interface SearchResult {
  symbol: string;
  displayName: string;
  assetClass: AssetClass;
  market: Market;
  exchange: string;
}
```

- [ ] **Step 2: server.ts (Phase 2 까지 placeholder)**

```ts
import "server-only";
export type { Quote, SearchResult, AssetClass, Market } from "./model/quote-types";

export async function listMarketQuote(_symbols: string[]): Promise<unknown> {
  throw new Error("listMarketQuote: Phase 2 에서 구현");
}

export async function fetchYahooSearch(_query: string): Promise<unknown> {
  throw new Error("fetchYahooSearch: Phase 2 에서 구현");
}
```

- [ ] **Step 3: client.ts (types only)**

```ts
export type { Quote, SearchResult, AssetClass, Market } from "./model/quote-types";
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/entities/stock
git commit -m "feat(stock-analysis): entities/stock 스켈레톤 (server-only quote/search + client types)"
```

---

## Task 1.5: entities/portfolio-holding 스켈레톤

**Files:**
- Create: `apps/dashboard/src/entities/portfolio-holding/model/types.ts`
- Create: `apps/dashboard/src/entities/portfolio-holding/server.ts`
- Create: `apps/dashboard/src/entities/portfolio-holding/client.ts`

- [ ] **Step 1: model/types.ts**

```ts
import type { AssetClass, Market } from "@/entities/stock/client";

export interface PortfolioHolding {
  id: string;
  userId: string;
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  quantity: string; // numeric 8자리 정밀도 → string
  avgCost: string;
  purchasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewPortfolioHolding {
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  quantity: string;
  avgCost: string;
  purchasedAt?: string | null;
}
```

- [ ] **Step 2: server.ts (Drizzle query — getHoldings 만 v1)**

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import type { PortfolioHolding, NewPortfolioHolding } from "./model/types";

export type { PortfolioHolding, NewPortfolioHolding };

export async function getHoldings(userId: string): Promise<PortfolioHolding[]> {
  const rows = await db
    .select()
    .from(portfolioHoldings)
    .where(eq(portfolioHoldings.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    symbol: r.symbol,
    assetClass: r.assetClass as PortfolioHolding["assetClass"],
    market: r.market as PortfolioHolding["market"],
    displayName: r.displayName,
    quantity: r.quantity,
    avgCost: r.avgCost,
    purchasedAt: r.purchasedAt,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
```

- [ ] **Step 3: client.ts (types only)**

```ts
export type { PortfolioHolding, NewPortfolioHolding } from "./model/types";
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/entities/portfolio-holding
git commit -m "feat(stock-analysis): entities/portfolio-holding 스켈레톤"
```

---

## Task 1.6: entities/stock-analysis 스켈레톤

**Files:**
- Create: `apps/dashboard/src/entities/stock-analysis/model/persona-types.ts`
- Create: `apps/dashboard/src/entities/stock-analysis/model/consensus-types.ts`
- Create: `apps/dashboard/src/entities/stock-analysis/server.ts`
- Create: `apps/dashboard/src/entities/stock-analysis/client.ts`

- [ ] **Step 1: model/persona-types.ts**

```ts
export type PersonaKey = "wallStreet" | "krExpert" | "value" | "growth" | "technical";
export type PersonaOrConsensus = PersonaKey | "consensus";
export type ModelName = "claude" | "codex" | "gemini";
export type Verdict = "BUY" | "HOLD" | "SELL";

export interface PersonaAnalysis {
  persona: PersonaKey;
  verdict: Verdict;
  oneLineThesis: string;
  narrative: string;
  keyMetrics: Record<string, number | string>;
  risks: string[];
  modelUsed: ModelName;
}

export const PERSONA_DISPLAY: Record<PersonaKey, string> = {
  wallStreet: "월스트리트 전문가",
  krExpert: "한국 전문가",
  value: "가치 투자",
  growth: "성장 투자",
  technical: "기술적 분석",
};

export const DEFAULT_PERSONA_MODELS: Record<PersonaOrConsensus, ModelName> = {
  wallStreet: "claude",
  krExpert: "claude",
  value: "codex",
  growth: "gemini",
  technical: "codex",
  consensus: "claude",
};
```

- [ ] **Step 2: model/consensus-types.ts**

```ts
import type { PersonaKey, Verdict, ModelName } from "./persona-types";

export interface Consensus {
  verdict: Verdict;
  score: string;
  oneLineConsensus: string;
  agreements: string[];
  disagreements: string[];
  riskRanking: string[];
  modelUsed: ModelName;
  successfulPersonas: PersonaKey[];
  failedPersonas: PersonaKey[];
}

export interface MarketSnapshot {
  price: number;
  changePct: number;
  currency: string;
  marketCap?: number;
  per?: number;
  pbr?: number;
  dividendYield?: number;
  debtRatio?: number;
  rsi14?: number;
  ma20?: number;
  ma60?: number;
  asOf: string;
}
```

- [ ] **Step 3: server.ts (cache CRUD)**

```ts
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db";
import { stockAnalysisCache } from "@/shared/lib/db/schema";
import type { PersonaAnalysis, PersonaKey } from "./model/persona-types";
import type { Consensus, MarketSnapshot } from "./model/consensus-types";

export type {
  PersonaAnalysis,
  PersonaKey,
  PersonaOrConsensus,
  ModelName,
  Verdict,
} from "./model/persona-types";
export type { Consensus, MarketSnapshot } from "./model/consensus-types";
export { DEFAULT_PERSONA_MODELS, PERSONA_DISPLAY } from "./model/persona-types";

export const PROMPT_VERSION = "v1.0";

export interface CachedAnalysisRow {
  symbol: string;
  analysisDate: string;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  marketSnapshot: MarketSnapshot;
  promptVersion: string;
  generatedAt: string;
}

export async function getCachedAnalysis(
  symbol: string,
  analysisDate: string,
  userId: string | null,
): Promise<CachedAnalysisRow | null> {
  const rows = await db
    .select()
    .from(stockAnalysisCache)
    .where(
      and(
        eq(stockAnalysisCache.symbol, symbol),
        eq(stockAnalysisCache.analysisDate, analysisDate),
        userId === null
          ? sql`${stockAnalysisCache.userId} IS NULL`
          : eq(stockAnalysisCache.userId, userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    symbol: r.symbol,
    analysisDate: r.analysisDate,
    personas: r.personas as CachedAnalysisRow["personas"],
    consensus: r.consensus as Consensus,
    marketSnapshot: r.marketSnapshot as MarketSnapshot,
    promptVersion: r.promptVersion,
    generatedAt: r.generatedAt.toISOString(),
  };
}

export interface UpsertAnalysisArgs {
  symbol: string;
  analysisDate: string;
  userId: string | null;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  marketSnapshot: MarketSnapshot;
}

export async function upsertAnalysis(args: UpsertAnalysisArgs): Promise<void> {
  await db
    .insert(stockAnalysisCache)
    .values({
      symbol: args.symbol,
      analysisDate: args.analysisDate,
      userId: args.userId,
      personas: args.personas,
      consensus: args.consensus,
      marketSnapshot: args.marketSnapshot,
      promptVersion: PROMPT_VERSION,
    })
    .onConflictDoUpdate({
      target: [
        stockAnalysisCache.symbol,
        stockAnalysisCache.analysisDate,
        stockAnalysisCache.userId,
      ],
      set: {
        personas: args.personas,
        consensus: args.consensus,
        marketSnapshot: args.marketSnapshot,
        promptVersion: PROMPT_VERSION,
        generatedAt: sql`now()`,
      },
    });
}
```

- [ ] **Step 4: client.ts**

```ts
export type {
  PersonaAnalysis,
  PersonaKey,
  PersonaOrConsensus,
  ModelName,
  Verdict,
} from "./model/persona-types";
export type { Consensus, MarketSnapshot } from "./model/consensus-types";
export { PERSONA_DISPLAY, DEFAULT_PERSONA_MODELS } from "./model/persona-types";
```

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors. nullable userId 와 unique index 의 PostgreSQL 동작 검증은 Phase 6 에서 실제 INSERT 로 확인.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/entities/stock-analysis
git commit -m "feat(stock-analysis): entities/stock-analysis 스켈레톤 (cache CRUD + types)"
```

---

## Task 1.7: Phase 1 종합 검증 + PR

- [ ] **Step 1: 전체 typecheck**

Run: `pnpm typecheck`
Expected: 모든 패키지 PASS.

- [ ] **Step 2: 전체 lint**

Run: `pnpm lint`
Expected: PASS. ESLint boundaries 위반 없음.

- [ ] **Step 3: 마이그레이션 SQL 검증**

Run: `ls apps/dashboard/drizzle/*.sql | tail -3`
Expected: 신규 1-2 파일 (테이블 + CHECK).

- [ ] **Step 4: 운영 DB 적용 보류**

`pnpm db:migrate --i-know-this-is-prod` 은 Phase 8 에서 일괄. 본 PR 머지는 type/스키마 정의만.

- [ ] **Step 5: PR 작성**

```bash
git push -u origin <branch>
gh pr create --title "feat(stock-analysis): Phase 1 — Scaffold + Schema" --body "$(cat <<'EOF'
## Summary
- @gons/stock-analysis 패키지 부트스트랩
- Drizzle 4 테이블 + CHECK 제약
- entities 3개 스켈레톤 — server/client 분리

## Test plan
- [x] pnpm typecheck PASS
- [x] pnpm lint PASS
- [x] 마이그레이션 SQL 시각 검증

운영 DB 적용은 Phase 8 에서 일괄.

🤖 Generated with Claude Code
EOF
)"
```

---

## Phase 1 self-check

- [ ] `pnpm typecheck && pnpm lint` PASS
- [ ] `apps/dashboard/drizzle/` 에 4 테이블 + CHECK 제약 SQL 존재
- [ ] entities 3개 모두 server.ts + client.ts 분리 완료
- [ ] PR 머지 후 main Docker 빌드 success (`gh run watch`)

Phase 1 PR 머지 후 Phase 2 (Yahoo Adapter) 진입 — `phase-2-yahoo-adapter.md` 참조.
