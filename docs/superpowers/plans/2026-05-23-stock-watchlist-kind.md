# 포트폴리오 관심종목(watchlist) 분석 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보유하지 않은 종목(수량/평단 없음)도 포트폴리오 위젯에 등록하여 페르소나 분석·합의·flip 알림을 받을 수 있도록 `portfolio_holdings` 에 `kind('holding'|'watchlist')` 컬럼을 도입한다.

**Architecture:** `portfolio_holdings.kind` 컬럼 + `quantity/avg_cost` NULL 허용으로 같은 테이블에 두 종류 공존. `push_opt_in` 컬럼으로 종목별 flip 푸시 토글 (관심 기본 OFF, 보유 기본 ON). cron `stock-analyze` 는 kind 무관 전체 순회 (선택된 정책). 관심종목 개수 캡(env `STOCK_WATCHLIST_MAX_PER_USER`, 기본 10). 위젯은 "보유 (n)" / "관심 (m)" 두 섹션으로 분리하고 hero 는 보유 우선. 손익률 라벨은 `avgCost` null/0 안전 처리.

**Tech Stack:** PostgreSQL 16 + Drizzle ORM (numeric NULL 허용 + check 제약), Next.js 16 App Router (RSC + Server Action), Zod discriminatedUnion, Vitest unit test, FSD (features/entities/widgets boundary 준수)

**관련 메모리·gotcha:**
- Drizzle snapshot id 충돌 복구 — `~/.claude/projects/-home-gon-projects-gon-gons-dashboard/memory/drizzle-snapshot-id-collision.md`
- features barrel server/client seam — `~/.claude/projects/-home-gon-projects-gon-gons-dashboard/memory/features-barrel-server-client-seam.md`
- CI Build success ≠ 운영 배포 — `~/.claude/projects/-home-gon-projects-gon-gons-dashboard/memory/ci-build-not-equals-deploy.md`
- Docker 배포 검증 4단계 — `~/.claude/projects/-home-gon-projects-gon-gons-dashboard/memory/docker-deploy-verify-pattern.md`

---

## File Structure

각 파일의 책임 + 변경 범위.

### 신규 파일
- `apps/dashboard/drizzle/0XXX_watchlist_kind.sql` — 자동 생성 (db:generate)
- `apps/dashboard/src/features/stock-portfolio-crud/model/schema.test.ts` — Zod discriminatedUnion 케이스 검증
- `apps/dashboard/src/features/stock-portfolio-crud/api/addHolding.test.ts` — 캡 초과 + kind 분기 검증
- `apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.test.tsx` — avgCost null/0 라벨 안전성 검증

### 수정 파일
- `apps/dashboard/src/shared/lib/db/schema.ts:963-984` — `portfolioHoldings` 에 `kind`, `pushOptIn` 추가 + quantity/avgCost NULL 허용
- `apps/dashboard/src/shared/config/env.ts` — `STOCK_WATCHLIST_MAX_PER_USER` 추가
- `.env.example` — 같은 변수 안내
- `apps/dashboard/src/entities/portfolio-holding/model/types.ts` — 타입에 `kind`, `pushOptIn` + null 허용
- `apps/dashboard/src/entities/portfolio-holding/server.ts` — `getHoldings` 매핑 갱신
- `apps/dashboard/src/features/stock-portfolio-crud/model/schema.ts` — `discriminatedUnion("kind", ...)` 적용 + pushOptIn
- `apps/dashboard/src/features/stock-portfolio-crud/api/addHolding.ts` — 캡 검증 + kind 분기 insert
- `apps/dashboard/src/features/stock-portfolio-crud/api/updateHolding.ts` — kind/pushOptIn 갱신 허용
- `apps/dashboard/src/features/stock-portfolio-crud/ui/PortfolioTable.tsx` — 보유/관심 라디오 + 섹션 분리
- `apps/dashboard/src/features/stock-portfolio-crud/ui/HoldingRow.tsx` — 관심 행 quantity/avgCost cell "—" + push 토글
- `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx` — kind 별 섹션 분리 + headline 우선순위(보유>관심)
- `apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.tsx:23-28,45` — `formatChange` avgCost null 안전 + "—" 라벨
- `apps/dashboard/src/app/api/cron/stock-analyze/route.ts:65-92,117-127` — holders 그룹핑에 kind/pushOptIn 포함, flip 알림 분기

---

## Task 1: DB 스키마 변경 (kind + push_opt_in + NULL 허용)

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts:963-984`
- Create (자동 생성): `apps/dashboard/drizzle/0XXX_watchlist_kind.sql`

- [ ] **Step 1: schema.ts 의 `portfolioHoldings` 정의 교체**

`apps/dashboard/src/shared/lib/db/schema.ts:963-984` 의 `portfolioHoldings` 블록을 다음으로 교체. NOT NULL 두 곳 제거, `kind` + `pushOptIn` 추가, CHECK 제약은 raw SQL.

```ts
import { check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const portfolioHoldings = pgTable(
  "portfolio_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class").notNull(),
    market: text("market").notNull(),
    displayName: text("display_name").notNull(),
    // watchlist 일 때 NULL 허용 — CHECK 로 강제
    quantity: numeric("quantity", { precision: 20, scale: 8 }),
    avgCost: numeric("avg_cost", { precision: 20, scale: 8 }),
    purchasedAt: date("purchased_at"),
    // kind: 'holding' (실제 보유) | 'watchlist' (관심만)
    kind: text("kind").notNull().default("holding"),
    // flip 푸시 알림 토글 — 보유 기본 true, 관심 기본 false (server action 에서 분기)
    pushOptIn: boolean("push_opt_in").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("portfolio_holdings_user_symbol_uq").on(t.userId, t.symbol),
    index("portfolio_holdings_user_idx").on(t.userId),
    check(
      "portfolio_holdings_kind_check",
      sql`${t.kind} IN ('holding', 'watchlist')`,
    ),
    check(
      "portfolio_holdings_holding_qty_check",
      sql`(${t.kind} = 'watchlist') OR (${t.quantity} IS NOT NULL AND ${t.avgCost} IS NOT NULL)`,
    ),
  ],
);
```

파일 상단 import 에 `boolean`, `check` 가 있는지 확인. 없으면 `import { ..., boolean, check } from "drizzle-orm/pg-core";` 추가. `sql` 은 `drizzle-orm`에서 import.

- [ ] **Step 2: drizzle migration 생성**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: `apps/dashboard/drizzle/0XXX_watchlist_kind.sql` 생성. 충돌 발생 시 메모리 `drizzle-snapshot-id-collision.md` 패턴 — `0XXX_snapshot.json` 의 `id` (새 UUID) 와 `prevId` (직전 entry id) 두 줄만 수정 후 별도 commit.

생성된 SQL 이 다음을 포함해야 함:
- `ALTER TABLE "portfolio_holdings" ALTER COLUMN "quantity" DROP NOT NULL;`
- `ALTER TABLE "portfolio_holdings" ALTER COLUMN "avg_cost" DROP NOT NULL;`
- `ALTER TABLE "portfolio_holdings" ADD COLUMN "kind" text DEFAULT 'holding' NOT NULL;`
- `ALTER TABLE "portfolio_holdings" ADD COLUMN "push_opt_in" boolean DEFAULT true NOT NULL;`
- `ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_kind_check" CHECK (...);`
- `ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_holding_qty_check" CHECK (...);`

drizzle-kit 가 CHECK 제약을 자동 생성하지 않으면 같은 파일에 수동 추가.

- [ ] **Step 3: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (entity types + server action 은 다음 task 에서 갱신. type error 가 남아도 schema.ts 자체가 깨지지 않았는지만 본다)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(stock-analysis): portfolio_holdings 에 kind + push_opt_in 컬럼 추가, quantity/avg_cost NULL 허용"
```

---

## Task 2: Entity 타입 + server.ts 갱신

**Files:**
- Modify: `apps/dashboard/src/entities/portfolio-holding/model/types.ts`
- Modify: `apps/dashboard/src/entities/portfolio-holding/server.ts`

- [ ] **Step 1: types.ts 갱신**

`apps/dashboard/src/entities/portfolio-holding/model/types.ts` 전체를 다음으로 교체:

```ts
import type { AssetClass, Market } from "@/shared/lib/stock/types";

export type PortfolioHoldingKind = "holding" | "watchlist";

export interface PortfolioHolding {
  id: string;
  userId: string;
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  kind: PortfolioHoldingKind;
  // watchlist 면 null. numeric(20,8) → string 보존.
  quantity: string | null;
  avgCost: string | null;
  purchasedAt: string | null;
  pushOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewPortfolioHolding {
  symbol: string;
  assetClass: AssetClass;
  market: Market;
  displayName: string;
  kind: PortfolioHoldingKind;
  quantity?: string | null;
  avgCost?: string | null;
  purchasedAt?: string | null;
  pushOptIn?: boolean;
}
```

- [ ] **Step 2: server.ts 매핑 갱신**

`apps/dashboard/src/entities/portfolio-holding/server.ts` 의 `getHoldings` 매핑 부분을 다음으로 갱신 (export 와 import 는 유지):

```ts
return rows.map((r) => ({
  id: r.id,
  userId: r.userId,
  symbol: r.symbol,
  assetClass: r.assetClass as PortfolioHolding["assetClass"],
  market: r.market as PortfolioHolding["market"],
  displayName: r.displayName,
  kind: r.kind as PortfolioHolding["kind"],
  quantity: r.quantity,
  avgCost: r.avgCost,
  purchasedAt: r.purchasedAt,
  pushOptIn: r.pushOptIn,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
}));
```

- [ ] **Step 3: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS. `holding.quantity` 또는 `holding.avgCost` 가 `string` 으로 가정된 곳에서 type error 가 발생하면 그 위치를 모두 기록 (Task 5/6/7 에서 처리). 이번 task 는 entity 변경만 끝.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/entities/portfolio-holding/
git commit -m "feat(stock-analysis): portfolio-holding entity 에 kind/pushOptIn + null quantity 반영"
```

---

## Task 3: env 변수 추가 (`STOCK_WATCHLIST_MAX_PER_USER`)

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: env.ts 에 변수 추가**

`apps/dashboard/src/shared/config/env.ts` 의 schema 정의에 다음 항목 추가 (다른 STOCK_* 변수 옆):

```ts
STOCK_WATCHLIST_MAX_PER_USER: z.coerce.number().int().min(0).default(10),
```

- [ ] **Step 2: .env.example 갱신**

`.env.example` 의 stock-analysis 섹션에 다음 줄 추가 (없으면 섹션과 함께):

```bash
# 사용자 1명당 등록 가능한 관심종목(watchlist) 최대 개수. 보유종목은 별도. 기본 10.
STOCK_WATCHLIST_MAX_PER_USER=10
```

- [ ] **Step 3: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/shared/config/env.ts .env.example
git commit -m "feat(stock-analysis): STOCK_WATCHLIST_MAX_PER_USER env 추가"
```

---

## Task 4: Zod schema 를 discriminatedUnion 으로 — failing test 부터

**Files:**
- Create: `apps/dashboard/src/features/stock-portfolio-crud/model/schema.test.ts`
- Modify: `apps/dashboard/src/features/stock-portfolio-crud/model/schema.ts`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/features/stock-portfolio-crud/model/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AddHoldingSchema } from "./schema";

describe("AddHoldingSchema", () => {
  const base = {
    symbol: "AAPL",
    assetClass: "stock" as const,
    market: "NASDAQ" as const,
    displayName: "Apple",
  };

  it("holding: quantity 와 avgCost 필수", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "holding",
      quantity: "10",
      avgCost: "150",
    });
    expect(result.success).toBe(true);
  });

  it("holding: quantity 비어있으면 reject", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "holding",
      avgCost: "150",
    });
    expect(result.success).toBe(false);
  });

  it("watchlist: quantity/avgCost 없어도 통과", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "watchlist",
    });
    expect(result.success).toBe(true);
  });

  it("watchlist: quantity 가 와도 통과 (선택 입력)", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      kind: "watchlist",
      quantity: "5",
    });
    expect(result.success).toBe(true);
  });

  it("kind 미지정 시 holding 으로 default", () => {
    const result = AddHoldingSchema.safeParse({
      ...base,
      quantity: "10",
      avgCost: "150",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("holding");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/features/stock-portfolio-crud/model/schema.test.ts`
Expected: FAIL — schema 에 `kind` 가 없거나 watchlist 분기가 없어 watchlist 케이스가 fail.

- [ ] **Step 3: schema.ts 교체**

`apps/dashboard/src/features/stock-portfolio-crud/model/schema.ts` 전체 교체:

```ts
import { z } from "zod";

const AssetClassSchema = z.enum(["stock", "crypto", "commodity"]);
const MarketSchema = z.enum(["NASDAQ", "NYSE", "KRX", "CRYPTO", "COMMODITY"]);

const PositiveNumericString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "양수 (소수점 8자리까지) 형식이어야 합니다");

const NonNegativeNumericString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "0 이상 (소수점 8자리까지) 형식이어야 합니다");

const baseHoldingFields = {
  symbol: z.string().min(1).max(32),
  assetClass: AssetClassSchema,
  market: MarketSchema,
  displayName: z.string().min(1).max(200),
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pushOptIn: z.boolean().optional(),
};

const HoldingVariantSchema = z.object({
  kind: z.literal("holding").default("holding"),
  quantity: PositiveNumericString,
  avgCost: NonNegativeNumericString,
  ...baseHoldingFields,
});

const WatchlistVariantSchema = z.object({
  kind: z.literal("watchlist"),
  quantity: PositiveNumericString.optional(),
  avgCost: NonNegativeNumericString.optional(),
  ...baseHoldingFields,
});

// kind 미지정 시 holding default 를 위해 preprocess + discriminatedUnion
export const AddHoldingSchema = z.preprocess(
  (input) => {
    if (typeof input === "object" && input !== null && !("kind" in input)) {
      return { ...input, kind: "holding" };
    }
    return input;
  },
  z.discriminatedUnion("kind", [HoldingVariantSchema, WatchlistVariantSchema]),
);

export const UpdateHoldingSchema = z.object({
  id: z.string().uuid(),
  quantity: PositiveNumericString.optional(),
  avgCost: NonNegativeNumericString.optional(),
  purchasedAt: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional(),
  kind: z.enum(["holding", "watchlist"]).optional(),
  pushOptIn: z.boolean().optional(),
});

export const DeleteHoldingSchema = z.object({
  id: z.string().uuid(),
});

export type AddHoldingInput = z.infer<typeof AddHoldingSchema>;
export type UpdateHoldingInput = z.infer<typeof UpdateHoldingSchema>;
export type DeleteHoldingInput = z.infer<typeof DeleteHoldingSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/features/stock-portfolio-crud/model/schema.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/stock-portfolio-crud/model/schema.ts apps/dashboard/src/features/stock-portfolio-crud/model/schema.test.ts
git commit -m "feat(stock-analysis): AddHoldingSchema discriminatedUnion (holding/watchlist) + 테스트"
```

---

## Task 5: addHolding Server Action — kind 분기 + 캡 검증

**Files:**
- Create: `apps/dashboard/src/features/stock-portfolio-crud/api/addHolding.test.ts`
- Modify: `apps/dashboard/src/features/stock-portfolio-crud/api/addHolding.ts`
- Modify: `apps/dashboard/src/features/stock-portfolio-crud/api/updateHolding.ts`

> 이 task 는 DB 의존이 있어 통합 테스트가 까다롭다. **input 분기 로직만 unit 으로 검증**하고 (캡 카운트는 mock), DB insert 자체는 운영 검증에 맡긴다.

- [ ] **Step 1: Write the failing test (input branching only)**

`apps/dashboard/src/features/stock-portfolio-crud/api/addHolding.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/shared/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const insertSpy = { values: undefined as unknown };
const insertReturning = vi.fn().mockResolvedValue([{ id: "h-1" }]);
const selectCount = vi.fn().mockResolvedValue([{ count: 0 }]);

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        insertSpy.values = v;
        return { returning: () => insertReturning() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => selectCount(),
      }),
    }),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/shared/config/env", () => ({
  env: { STOCK_WATCHLIST_MAX_PER_USER: 2 },
}));

import { addHolding } from "./addHolding";

beforeEach(() => {
  insertSpy.values = undefined;
  insertReturning.mockClear();
  selectCount.mockClear();
  selectCount.mockResolvedValue([{ count: 0 }]);
});

describe("addHolding", () => {
  const base = {
    symbol: "AAPL",
    assetClass: "stock" as const,
    market: "NASDAQ" as const,
    displayName: "Apple",
  };

  it("holding: quantity/avgCost insert 그대로 + pushOptIn=true default", async () => {
    const res = await addHolding({
      ...base,
      kind: "holding",
      quantity: "10",
      avgCost: "150",
    });
    expect(res.success).toBe(true);
    expect(insertSpy.values).toMatchObject({
      kind: "holding",
      quantity: "10",
      avgCost: "150",
      pushOptIn: true,
    });
  });

  it("watchlist: quantity/avgCost null insert + pushOptIn=false default", async () => {
    const res = await addHolding({
      ...base,
      kind: "watchlist",
    });
    expect(res.success).toBe(true);
    expect(insertSpy.values).toMatchObject({
      kind: "watchlist",
      quantity: null,
      avgCost: null,
      pushOptIn: false,
    });
  });

  it("watchlist: 캡 초과 시 reject", async () => {
    selectCount.mockResolvedValueOnce([{ count: 2 }]);
    const res = await addHolding({ ...base, kind: "watchlist" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/관심종목.*최대/);
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("watchlist: 명시적 pushOptIn=true override 가능", async () => {
    const res = await addHolding({
      ...base,
      kind: "watchlist",
      pushOptIn: true,
    });
    expect(res.success).toBe(true);
    expect(insertSpy.values).toMatchObject({
      kind: "watchlist",
      pushOptIn: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/features/stock-portfolio-crud/api/addHolding.test.ts`
Expected: FAIL — addHolding 이 아직 kind 분기/캡 검증을 안 함.

- [ ] **Step 3: addHolding.ts 교체**

`apps/dashboard/src/features/stock-portfolio-crud/api/addHolding.ts` 전체 교체:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { AddHoldingSchema, type AddHoldingInput } from "../model/schema";

export interface AddHoldingResult {
  success: boolean;
  error?: string;
  holdingId?: string;
}

export async function addHolding(input: AddHoldingInput): Promise<AddHoldingResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = AddHoldingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "검증 실패" };
  }
  const data = parsed.data;

  // watchlist 캡 검증
  if (data.kind === "watchlist") {
    const cap = env.STOCK_WATCHLIST_MAX_PER_USER;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(portfolioHoldings)
      .where(
        and(
          eq(portfolioHoldings.userId, session.user.id),
          eq(portfolioHoldings.kind, "watchlist"),
        ),
      );
    if ((row?.count ?? 0) >= cap) {
      return {
        success: false,
        error: `관심종목은 최대 ${cap}개까지 등록 가능합니다`,
      };
    }
  }

  // kind 별 pushOptIn 기본값
  const pushOptInDefault = data.kind === "holding";
  const pushOptIn = data.pushOptIn ?? pushOptInDefault;

  try {
    const [row] = await db
      .insert(portfolioHoldings)
      .values({
        userId: session.user.id,
        symbol: data.symbol,
        assetClass: data.assetClass,
        market: data.market,
        displayName: data.displayName,
        kind: data.kind,
        quantity: data.kind === "watchlist" ? data.quantity ?? null : data.quantity,
        avgCost: data.kind === "watchlist" ? data.avgCost ?? null : data.avgCost,
        purchasedAt: data.purchasedAt ?? null,
        pushOptIn,
      })
      .returning({ id: portfolioHoldings.id });
    revalidatePath("/");
    return { success: true, holdingId: row.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "DB 에러";
    if (msg.includes("portfolio_holdings_user_symbol_uq")) {
      return { success: false, error: "이미 등록된 종목입니다" };
    }
    return { success: false, error: msg };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/features/stock-portfolio-crud/api/addHolding.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: updateHolding 도 kind/pushOptIn 갱신 허용**

`apps/dashboard/src/features/stock-portfolio-crud/api/updateHolding.ts` 의 `updateValues` 분기에 다음 2줄 추가 (`quantity`/`avgCost` 분기 옆):

```ts
if (parsed.data.kind !== undefined) updateValues.kind = parsed.data.kind;
if (parsed.data.pushOptIn !== undefined) updateValues.pushOptIn = parsed.data.pushOptIn;
```

(`updateHolding.ts` 의 기존 패턴 — `if (parsed.data.X !== undefined) updateValues.X = parsed.data.X;` — 그대로 따라 적는다. updateValues type 추론에서 problem 나면 explicit type assertion 추가.)

- [ ] **Step 6: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/features/stock-portfolio-crud/api/
git commit -m "feat(stock-analysis): addHolding kind 분기 + watchlist 캡 검증, updateHolding kind/pushOptIn 갱신"
```

---

## Task 6: PortfolioTable UI — 보유/관심 라디오 + 섹션 분리

**Files:**
- Modify: `apps/dashboard/src/features/stock-portfolio-crud/ui/PortfolioTable.tsx`
- Modify: `apps/dashboard/src/features/stock-portfolio-crud/ui/HoldingRow.tsx`

- [ ] **Step 1: PortfolioTable.tsx — state + 폼 + 섹션 분리**

`apps/dashboard/src/features/stock-portfolio-crud/ui/PortfolioTable.tsx` 의 현재 함수 본체 (15-137행) 를 다음으로 교체. `import` 와 외부 시그니처는 유지.

```tsx
export function PortfolioTable({ initialHoldings }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [kind, setKind] = useState<"holding" | "watchlist">("holding");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.refresh();

  const onAdd = async () => {
    if (!selected) {
      setAddError("검색에서 종목을 선택해주세요");
      return;
    }
    if (kind === "holding") {
      if (quantity.length === 0 || avgCost.length === 0) {
        setAddError("수량과 평단을 입력해주세요");
        return;
      }
      if (Number(quantity) <= 0) {
        setAddError("수량은 0보다 커야 합니다");
        return;
      }
      if (Number(avgCost) < 0) {
        setAddError("평단은 0 이상이어야 합니다");
        return;
      }
    }
    setBusy(true);
    setAddError(null);
    const res = await addHolding({
      symbol: selected.symbol,
      assetClass: selected.assetClass,
      market: selected.market,
      displayName: selected.displayName,
      kind,
      quantity: kind === "holding" || quantity.length > 0 ? quantity : undefined,
      avgCost: kind === "holding" || avgCost.length > 0 ? avgCost : undefined,
      purchasedAt: purchasedAt.length > 0 ? purchasedAt : undefined,
    });
    setBusy(false);
    if (!res.success) {
      setAddError(res.error ?? "추가 실패");
      return;
    }
    setSelected(null);
    setQuantity("");
    setAvgCost("");
    setPurchasedAt("");
    refresh();
  };

  const holdings = initialHoldings.filter((h) => h.kind === "holding");
  const watchlist = initialHoldings.filter((h) => h.kind === "watchlist");

  const renderSection = (
    label: string,
    rows: PortfolioHolding[],
    emptyHint: string,
  ) => (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label} ({rows.length})
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-3 py-2">종목</th>
            <th className="px-3 py-2">자산군</th>
            <th className="px-3 py-2 text-right">수량</th>
            <th className="px-3 py-2 text-right">평단</th>
            <th className="px-3 py-2 text-right">매수일</th>
            <th className="px-3 py-2 text-center">🔔</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]"
              >
                {emptyHint}
              </td>
            </tr>
          ) : (
            rows.map((h) => <HoldingRow key={h.id} holding={h} onMutate={refresh} />)
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {renderSection("보유", holdings, "보유 종목이 없습니다.")}
      {renderSection("관심", watchlist, "관심 종목이 없습니다.")}

      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">+ 종목 추가</div>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="add-kind"
                value="holding"
                checked={kind === "holding"}
                onChange={() => setKind("holding")}
              />
              보유
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="add-kind"
                value="watchlist"
                checked={kind === "watchlist"}
                onChange={() => setKind("watchlist")}
              />
              관심 (수량 없음)
            </label>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <TickerSearchInput onSelect={setSelected} />
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={kind === "watchlist" ? "(선택)" : "수량"}
            disabled={busy}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          />
          <input
            type="text"
            inputMode="decimal"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
            placeholder={kind === "watchlist" ? "(선택)" : "평단"}
            disabled={busy}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          />
          <input
            type="date"
            value={purchasedAt}
            onChange={(e) => setPurchasedAt(e.target.value)}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "추가 중…" : "추가"}
          </button>
        </div>
        {addError && <div className="mt-2 text-xs text-red-600">{addError}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: HoldingRow.tsx — quantity/avgCost null 셀 + push 토글 셀**

`apps/dashboard/src/features/stock-portfolio-crud/ui/HoldingRow.tsx` 의 quantity/avgCost cell 부분 (104-109행) 을 다음으로 교체:

```tsx
<td className="px-3 py-2 text-right tabular-nums">
  {holding.kind === "watchlist" && holding.quantity == null
    ? <span className="text-[var(--color-text-muted)]">—</span>
    : renderCell("quantity", holding.quantity ?? "")}
</td>
<td className="px-3 py-2 text-right tabular-nums">
  {holding.kind === "watchlist" && holding.avgCost == null
    ? <span className="text-[var(--color-text-muted)]">—</span>
    : renderCell("avgCost", holding.avgCost ?? "")}
</td>
```

그 다음, 매수일 cell (110-112행) 뒤·삭제 버튼 cell 앞에 push 토글 cell 삽입:

```tsx
<td className="px-3 py-2 text-center">
  <button
    type="button"
    onClick={async () => {
      setBusy(true);
      const res = await updateHolding({
        id: holding.id,
        pushOptIn: !holding.pushOptIn,
      });
      setBusy(false);
      if (!res.success) {
        setError(res.error ?? "토글 실패");
        return;
      }
      onMutate();
    }}
    disabled={busy}
    aria-label={holding.pushOptIn ? "푸시 끄기" : "푸시 켜기"}
    className="rounded p-1 text-sm hover:bg-[var(--color-surface-2)] disabled:opacity-50"
  >
    {holding.pushOptIn ? "🔔" : "🔕"}
  </button>
</td>
```

PortfolioTable 의 thead 가 7개 (종목/자산군/수량/평단/매수일/🔔/삭제) 이므로 row 도 7개 td 가 맞는지 확인.

- [ ] **Step 3: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: build 검증 (features barrel server/client seam)**

Run: `cd apps/dashboard && pnpm build`
Expected: PASS. 만약 `Module not found: Can't resolve 'tls' / 'perf_hooks'` 같은 에러가 나면 메모리 `features-barrel-server-client-seam.md` 적용 — `features/stock-portfolio-crud/` barrel 의 server/client 분리 검토.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/stock-portfolio-crud/ui/
git commit -m "feat(stock-analysis): PortfolioTable 보유/관심 섹션 분리 + kind 라디오 + push 토글"
```

---

## Task 7: HoldingDetailButton — avgCost null/0 안전

**Files:**
- Modify: `apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.tsx:23-28,45`
- Create: `apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.test.tsx`

- [ ] **Step 1: `formatChange` 시그니처 확장 + export**

`apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.tsx` 의 `formatChange` 정의 (23-28행) 를 다음으로 교체:

```tsx
// avgCost null/0/NaN/Infinity 시 손익률 계산 불가 — "—" 라벨로 fallback.
export function formatChange(
  curr: number,
  avgCost: number | null,
): { pct: number | null; label: string; color: string } {
  if (avgCost == null || avgCost === 0 || !Number.isFinite(avgCost)) {
    return {
      pct: null,
      label: "—",
      color: "text-[var(--color-text-muted)]",
    };
  }
  const pct = ((curr - avgCost) / avgCost) * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "text-emerald-700" : "text-rose-700";
  return { pct, label: `${sign}${pct.toFixed(1)}%`, color };
}
```

호출부 45행 교체:

```tsx
const change = formatChange(
  snapshot.price,
  holding.avgCost == null ? null : Number(holding.avgCost),
);
```

- [ ] **Step 2: Write the test**

`apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { formatChange } from "./HoldingDetailButton";

describe("formatChange", () => {
  it("정상 케이스: 양수 손익률", () => {
    const res = formatChange(110, 100);
    expect(res.label).toBe("+10.0%");
    expect(res.color).toContain("emerald");
  });

  it("정상 케이스: 음수 손익률", () => {
    const res = formatChange(90, 100);
    expect(res.label).toBe("-10.0%");
    expect(res.color).toContain("rose");
  });

  it("avgCost=null (watchlist): '—' 라벨", () => {
    const res = formatChange(110, null);
    expect(res.label).toBe("—");
    expect(res.pct).toBeNull();
  });

  it("avgCost=0: '—' 라벨 (divide-by-zero 회피)", () => {
    const res = formatChange(110, 0);
    expect(res.label).toBe("—");
    expect(res.pct).toBeNull();
  });

  it("avgCost=NaN/Infinity: '—' 라벨", () => {
    expect(formatChange(110, Number.NaN).label).toBe("—");
    expect(formatChange(110, Number.POSITIVE_INFINITY).label).toBe("—");
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/widgets/stock-analysis/HoldingDetailButton.test.tsx`
Expected: 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.tsx apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.test.tsx
git commit -m "fix(stock-analysis): HoldingDetailButton 손익률 avgCost null/0/NaN 안전 처리"
```

---

## Task 8: StockAnalysisCard — kind 별 섹션 + headline 우선순위

**Files:**
- Modify: `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx`

- [ ] **Step 1: enriched 분리 + headline 우선순위 변경**

`StockAnalysisCard.tsx` 의 64-77행 (headline 선정 + pendingHoldings) 를 다음으로 교체:

```tsx
// kind 별로 분리 — headline 은 보유 우선, 보유 없으면 관심.
type EnrichedRow = (typeof enriched)[number];
const enrichedHoldings = enriched.filter((e) => e.holding.kind === "holding");
const enrichedWatchlist = enriched.filter((e) => e.holding.kind === "watchlist");

const pickHeadline = (pool: EnrichedRow[]): EnrichedRow | undefined => {
  const cached = pool.filter((e) => e.analysis !== null);
  return cached.sort((a, b) => {
    const aScore = Number(a.analysis?.consensus.score.split("/")[0] ?? 0);
    const bScore = Number(b.analysis?.consensus.score.split("/")[0] ?? 0);
    return bScore - aScore;
  })[0];
};

const headline = pickHeadline(enrichedHoldings) ?? pickHeadline(enrichedWatchlist);
const headlineSnapshot = headline?.analysis?.marketSnapshot;
const headlineQuote = headline?.quote;
const pendingHoldings = enriched
  .filter((e) => e.analysis === null)
  .map((e) => e.holding);
```

- [ ] **Step 2: 보유/관심 섹션 분리 렌더**

`StockAnalysisCard.tsx` 의 99-143행 (return <section>...</section>) 의 `<div className="flex flex-col gap-3">` 안 본체를 다음으로 교체:

```tsx
<div className="flex flex-col gap-3">
  {headline && headline.analysis && headlineSnapshot && (
    <HoldingDetailButton
      holding={headline.holding}
      personas={headline.analysis.personas}
      consensus={headline.analysis.consensus}
      snapshot={
        headlineQuote
          ? { ...headlineSnapshot, price: headlineQuote.price }
          : headlineSnapshot
      }
      dailyOHLC={headline.dailyOHLC}
      variant="hero"
    />
  )}

  {renderRowSection("보유", enrichedHoldings, headline?.holding.id)}
  {renderRowSection("관심", enrichedWatchlist, headline?.holding.id)}

  {pendingHoldings.length > 0 && (
    <AnalysisPendingPlaceholder holdings={pendingHoldings} />
  )}
</div>
```

같은 파일 하단 (export 밖) 에 helper 함수 추가:

```tsx
type EnrichedRowExport = {
  holding: Awaited<ReturnType<typeof getHoldings>>[number];
  quote: { price: number } | undefined;
  analysis: Awaited<ReturnType<typeof getCachedAnalysis>>;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
};

function renderRowSection(
  label: string,
  rows: EnrichedRowExport[],
  headlineId: string | undefined,
) {
  const cached = rows.filter(
    (e) => e.analysis !== null && e.holding.id !== headlineId,
  );
  if (cached.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label} ({rows.length})
      </div>
      {cached.map((e) => {
        if (!e.analysis) return null;
        const snap = e.quote
          ? { ...e.analysis.marketSnapshot, price: e.quote.price }
          : e.analysis.marketSnapshot;
        return (
          <HoldingDetailButton
            key={e.holding.id}
            holding={e.holding}
            personas={e.analysis.personas}
            consensus={e.analysis.consensus}
            snapshot={snap}
            dailyOHLC={e.dailyOHLC}
            variant="row"
          />
        );
      })}
    </div>
  );
}
```

EnrichedRow / EnrichedRowExport 타입 추론에서 type-narrow 충돌 나면 `EnrichedRowExport` 만 export 하지 않고 inline type 으로 적어도 됨 — 핵심은 props 시그니처 보존.

- [ ] **Step 3: typecheck + build**

Run: `cd apps/dashboard && pnpm typecheck && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx
git commit -m "feat(stock-analysis): StockAnalysisCard 보유/관심 섹션 분리 + headline 보유 우선"
```

---

## Task 9: cron stock-analyze — flip 알림 watchlist+pushOptIn=false skip

**Files:**
- Modify: `apps/dashboard/src/app/api/cron/stock-analyze/route.ts:35-92,117-127`

- [ ] **Step 1: `SymbolTarget` 타입에 holder 필드 확장**

`apps/dashboard/src/app/api/cron/stock-analyze/route.ts:35-41` 의 `SymbolTarget` 인터페이스를 다음으로 교체:

```ts
interface SymbolTarget {
  symbol: string;
  displayName: string;
  assetClass: PortfolioHolding["assetClass"];
  market: PortfolioHolding["market"];
  holders: Array<{
    userId: string;
    kind: "holding" | "watchlist";
    pushOptIn: boolean;
  }>;
}
```

- [ ] **Step 2: SELECT + grouped 빌더 갱신**

`apps/dashboard/src/app/api/cron/stock-analyze/route.ts:64-92` 의 `targetSelect` 함수 본체를 다음으로 교체:

```ts
targetSelect: async () => {
  const rows = await db
    .select({
      symbol: portfolioHoldings.symbol,
      displayName: portfolioHoldings.displayName,
      assetClass: portfolioHoldings.assetClass,
      market: portfolioHoldings.market,
      userId: portfolioHoldings.userId,
      kind: portfolioHoldings.kind,
      pushOptIn: portfolioHoldings.pushOptIn,
    })
    .from(portfolioHoldings)
    .where(marketFilter);

  const grouped = new Map<string, SymbolTarget>();
  for (const r of rows) {
    const holder = {
      userId: r.userId,
      kind: r.kind as "holding" | "watchlist",
      pushOptIn: r.pushOptIn,
    };
    const existing = grouped.get(r.symbol);
    if (existing) {
      existing.holders.push(holder);
    } else {
      grouped.set(r.symbol, {
        symbol: r.symbol,
        displayName: r.displayName,
        assetClass: r.assetClass as PortfolioHolding["assetClass"],
        market: r.market as PortfolioHolding["market"],
        holders: [holder],
      });
    }
  }
  return [...grouped.values()];
},
```

- [ ] **Step 3: flip 알림 루프 갱신**

`apps/dashboard/src/app/api/cron/stock-analyze/route.ts:115-127` 의 flip 알림 블록을 다음으로 교체:

```ts
let flipped = 0;
let notified = 0;
if (detection) {
  for (const holder of t.holders) {
    // watchlist 이고 pushOptIn=false 면 알림 skip (기본값)
    if (holder.kind === "watchlist" && !holder.pushOptIn) continue;
    flipped += 1;
    const notifyResult = await notifyFlip({
      userId: holder.userId,
      detection,
      displayName: t.displayName,
    });
    if (notifyResult.kind === "notified") notified += 1;
  }
}
```

(`flipped` 의미가 "전체 holder 수" → "알림 대상 holder 수" 로 변경. commit 메시지에 명시.)

- [ ] **Step 4: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/cron/stock-analyze/route.ts
git commit -m "feat(stock-analysis): cron flip 알림 watchlist + pushOptIn=false skip (flipped 의미: 알림 대상 holder 수)"
```

---

## Task 10: 통합 검증 — build + lint + 전체 test

**Files:** 없음 (전체 검증)

- [ ] **Step 1: typecheck + lint + test + build 전체 실행**

Run:
```bash
cd apps/dashboard
pnpm typecheck
pnpm lint
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
pnpm build
```

Expected:
- typecheck/lint/build: PASS
- test: 추가한 unit test (Task 4/5/7) 모두 PASS. DB 통합 테스트가 ECONNREFUSED 로 fail 하는 것은 OK (CLAUDE.md Gotcha #2)

- [ ] **Step 2: drizzle migration 추가 변경 없는지 확인**

Run:
```bash
cd apps/dashboard
pnpm db:generate
git status drizzle/
```
Expected: 추가 변경 없음 (Task 1 에서 이미 생성됨). 변경이 있다면 Task 1 commit 에 amend 하지 말고 새 commit 으로 추가.

---

## Task 11: PR + 운영 배포 (사용자 승인 후)

**Files:** 없음 (배포 단계)

- [ ] **Step 1: feature branch 생성 + push**

Run:
```bash
git checkout -b feat/stock-watchlist-kind
git push -u origin feat/stock-watchlist-kind
```

- [ ] **Step 2: PR 생성**

Run:
```bash
gh pr create --title "feat(stock-analysis): 관심종목(watchlist) 분석 확장" --body "$(cat <<'EOF'
## Summary
- `portfolio_holdings.kind ('holding'|'watchlist')` 컬럼 추가, watchlist 일 때 `quantity/avg_cost` NULL 허용
- `push_opt_in` 컬럼 추가 (보유 기본 ON, 관심 기본 OFF, 종목별 🔔 토글)
- 위젯에 보유/관심 두 섹션 분리, headline 은 보유 우선 → 관심 차순
- cron 은 kind 무관 전체 순회 (기존 정책 유지), flip push 는 `watchlist + pushOptIn=false` 만 skip
- `STOCK_WATCHLIST_MAX_PER_USER` env (기본 10) 로 관심종목 캡 적용
- `HoldingDetailButton.formatChange` avgCost null/0/NaN 안전 처리 ("—" 라벨)

## Test plan
- [ ] `pnpm typecheck && pnpm lint && pnpm build` 통과
- [ ] Schema discriminatedUnion unit test (holding/watchlist/default) 통과
- [ ] addHolding kind 분기 + 캡 검증 unit test 통과
- [ ] formatChange null/0/NaN unit test 통과
- [ ] 로컬에서 watchlist 종목 추가 → StockAnalysisCard "관심" 섹션에 표시 확인
- [ ] 운영 DB 마이그레이션 적용 후 기존 holdings 가 kind='holding' default 로 유지되는지 확인
- [ ] 운영 docker pull/up 후 /api/health 200 확인
EOF
)"
```

- [ ] **Step 3: 사용자 머지 승인 대기**

사용자가 PR review + merge 한 뒤에만 다음 step 진행. **자동 머지 금지**.

- [ ] **Step 4: 운영 DB 마이그레이션 적용**

Run (사용자 승인 후):
```bash
cd apps/dashboard
I_KNOW_THIS_IS_PROD=1 pnpm db:migrate
```
Expected: `0XXX_watchlist_kind.sql` 적용 성공.

검증:
```bash
ssh gon@192.168.0.5 "docker exec gons-dashboard-postgres psql -U gons -d gons -c '\d portfolio_holdings'"
```
Expected: `kind text NOT NULL DEFAULT 'holding'`, `push_opt_in boolean NOT NULL DEFAULT true`, `quantity numeric(20,8)` (NOT NULL 없음), `avg_cost numeric(20,8)` (NOT NULL 없음) 확인.

- [ ] **Step 5: docker pull/up + 헬스체크**

메모리 `docker-deploy-verify-pattern.md` 4단계:

```bash
COMPOSE=/home/gon/projects/gon/gons-dashboard/docker-compose.yml
docker --context home-server compose -f $COMPOSE pull app cron
docker --context home-server compose -f $COMPOSE up -d app cron
ssh gon@192.168.0.5 "curl -sI http://localhost:3020/api/health"
```
Expected: HTTP/1.1 200 OK.

메모리 `ci-build-not-equals-deploy.md` — image SHA 가 main 의 최신 GHA run 과 일치하는지, `.next` 안에 새 컬럼 grep 으로 확인.

---

## Self-Review

이 plan 의 spec coverage:

1. **DB 게이트 해소** ✓ Task 1 — NOT NULL 제거 + kind/push_opt_in 추가 + CHECK 제약
2. **Zod 게이트 해소** ✓ Task 4 — discriminatedUnion, watchlist 일 때 optional
3. **UI 게이트 해소** ✓ Task 6 — `kind === "holding"` 일 때만 빈 값 차단
4. **분석 로직** ✓ 변경 불필요 (정밀 분석 단계에서 확인) — packages/stock-analysis 는 quantity/avgCost 비의존
5. **avgCost null/0 안전** ✓ Task 7 — formatChange "—" 라벨
6. **위젯 섹션 분리** ✓ Task 6 (설정 모달 CRUD 탭) + Task 8 (메인 카드)
7. **cron 정책** ✓ Task 9 + Task 1 — kind 무관 전체 순회 유지, flip push 만 분기
8. **관심종목 캡** ✓ Task 3 (env) + Task 5 (검증)
9. **운영 배포** ✓ Task 11

placeholder 없음. 모든 step 에 실제 코드/명령/expected 포함. type 일관성 — `kind: "holding" | "watchlist"`, `pushOptIn: boolean`, `formatChange(curr, avgCost: number | null)` 시그니처가 모든 task 에서 동일.
