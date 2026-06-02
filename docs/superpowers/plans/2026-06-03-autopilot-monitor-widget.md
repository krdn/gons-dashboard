# autopilot 모니터링 위젯 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gons-dashboard에 autopilot 사이클 이력·다음 후보를 보여주는 모니터링 위젯을 추가한다.

**Architecture:** `autopilot_cycles` DB 테이블에 사이클 결과를 영속화하고, 저장 전용 cron 라우트(`POST /api/cron/autopilot-cycle`, Bearer)로 주간 에이전트가 Workflow 반환값을 기록한다. 대시보드 RSC가 entity server fn(Drizzle)으로 이력·후보를 읽고, status(mode·deploy)는 최신 cycle row에서 파생한다. 위젯은 좌측 메인 컬럼에 배치하며 이력 0건 empty state를 우선한다.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript strict, Drizzle ORM + PostgreSQL, Zod, Vitest, Tailwind v4. FSD 아키텍처.

**Spec:** `docs/superpowers/specs/2026-06-03-autopilot-monitor-widget-design.md` (commit 66a50b9, 정정 604fe94)

**Spec과의 deviation (의도적):**
- 스펙은 테이블을 `entities/autopilot-cycle/model/schema.ts`에 둔다 했으나, 코드베이스 컨벤션은 모든 Drizzle 테이블을 중앙 `shared/lib/db/schema.ts`에 정의하고 entity는 타입만 노출한다. **중앙 schema.ts 컨벤션을 따른다.**

---

## File Structure

**생성:**
- `apps/dashboard/src/entities/autopilot-cycle/model/types.ts` — 순수 타입 (AutopilotCycle, BacklogCandidate, DebateEntry, DebateLog, AutopilotStatus)
- `apps/dashboard/src/entities/autopilot-cycle/model/inputSchema.ts` — Zod 입력 스키마 (cron 라우트용)
- `apps/dashboard/src/entities/autopilot-cycle/api/recordCycle.ts` — server: upsert
- `apps/dashboard/src/entities/autopilot-cycle/api/getCycles.ts` — server: 이력 조회
- `apps/dashboard/src/entities/autopilot-cycle/api/getAutopilotView.ts` — server: 위젯 1회 조회 (이력 + 최신 backlog + status 묶음)
- `apps/dashboard/src/entities/autopilot-cycle/server.ts` — server barrel
- `apps/dashboard/src/entities/autopilot-cycle/client.ts` — client barrel
- `apps/dashboard/src/widgets/autopilot/ui/AutopilotCard.tsx` — RSC
- `apps/dashboard/src/widgets/autopilot/ui/AutopilotStatus.tsx` — client
- `apps/dashboard/src/widgets/autopilot/ui/CycleHistoryList.tsx` — client
- `apps/dashboard/src/widgets/autopilot/ui/NextCandidates.tsx` — client
- `apps/dashboard/src/widgets/autopilot/ui/AutopilotSkeleton.tsx` — client
- `apps/dashboard/src/widgets/autopilot/index.ts` — widget barrel
- `apps/dashboard/src/app/api/cron/autopilot-cycle/route.ts` — POST 저장 라우트
- `apps/dashboard/tests/autopilot/recordCycle.test.ts` — DB 통합 테스트
- `apps/dashboard/tests/autopilot/inputSchema.test.ts` — Zod 단위 테스트
- `apps/dashboard/tests/autopilot/autopilot-cycle-route.test.ts` — 라우트 테스트
- `apps/dashboard/tests/autopilot/widget-render.test.ts` — UI 단위 테스트

**수정:**
- `apps/dashboard/src/shared/lib/db/schema.ts` — `autopilotCycles` 테이블 추가
- `apps/dashboard/src/app/page.tsx` — AutopilotCard 배치

---

## Task 1: DB 테이블 `autopilot_cycles`

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` (파일 끝에 추가)

- [ ] **Step 1: 테이블 정의 추가**

`apps/dashboard/src/shared/lib/db/schema.ts` 파일 끝에 추가. (파일 상단 import에 `jsonb`, `real`, `boolean`, `integer`, `text`, `timestamp`는 이미 존재 — 확인만. `real`이 없으면 import에 추가.)

```typescript
/* =========================================================================
 * gons-autopilot — 주간 자율 업그레이드 사이클 이력
 * 저장: POST /api/cron/autopilot-cycle (주간 에이전트가 Workflow 반환값 기록)
 * 읽기: widgets/autopilot (RSC)
 * id = "autopilot-<isoWeek>" 멱등 키. 주차별 index 불필요 (PK가 isoWeek).
 * ========================================================================= */
export const autopilotCycles = pgTable("autopilot_cycles", {
  id: text("id").primaryKey(), // "autopilot-2026-W24"
  date: timestamp("date", { withTimezone: true }).notNull(),
  mode: text("mode").notNull(), // "shadow" | "autonomous"
  deployFlag: text("deploy_flag"), // "on" | "off" | null — 저장 시점 cron의 AUTOPILOT_DEPLOY
  candidateCount: integer("candidate_count").notNull(),

  selectedTitle: text("selected_title"),
  selectedScore: real("selected_score"),
  selectedChangeType: text("selected_change_type"),
  selectedOwner: text("selected_owner"),

  prUrl: text("pr_url"),
  merged: boolean("merged").notNull().default(false),
  needsHuman: boolean("needs_human").notNull().default(false),
  reason: text("reason"),

  backlogTop3: jsonb("backlog_top3")
    .$type<{ title: string; score: number; dedupKey: string }[]>()
    .notNull()
    .default([]),
  debate: jsonb("debate").$type<unknown>(), // DebateLog — entity types에서 정제

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `apps/dashboard/drizzle/`(또는 설정된 out 경로)에 새 `NNNN_*.sql` 생성, `CREATE TABLE "autopilot_cycles"` 포함. snapshot 충돌 시 메모리 drizzle-snapshot-id-collision 절차로 id/prevId 수정.

- [ ] **Step 3: 마이그레이션 SQL 육안 확인**

Run: `git diff --stat apps/dashboard/drizzle/`
Expected: 새 .sql 1개 + snapshot/journal 갱신. `CREATE TABLE`에 컬럼 + jsonb 2개 확인. (운영 적용은 본 작업 범위 밖 — 메모리 drizzle-kit-migrate-prod-broken 때문에 운영은 psql 직접.)

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: PASS (스키마만 추가, 아직 소비처 없음)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(autopilot): autopilot_cycles 테이블 + 마이그레이션"
```

---

## Task 2: entity 타입 (`model/types.ts`)

**Files:**
- Create: `apps/dashboard/src/entities/autopilot-cycle/model/types.ts`

- [ ] **Step 1: 타입 정의**

```typescript
// entities/autopilot-cycle — 순수 타입.
// cycle.workflow.js 의 logEntry/debate() 반환 구조와 1:1.

export type ChangeType = "deps" | "security" | "refactor" | "feature" | "ui" | "perf";

export interface BacklogCandidate {
  title: string;
  score: number;
  dedupKey: string;
}

export interface DebateEntry {
  title: string;
  owner: string;
  score: number;
  changeType: string;
  dedupKey: string;
  crossReview: { challenge: string; severity: "low" | "medium" | "high"; wouldBlock: boolean }[];
  verdicts: { valueScore: number; safetyScore: number; feasibilityScore: number }[];
}

export interface DebateLog {
  selected: DebateEntry | null;
  backlogTop3: DebateEntry[];
}

/** 한 사이클의 위젯 표시용 형태 (DB row → 정제). */
export interface AutopilotCycle {
  id: string; // "autopilot-2026-W24"
  isoWeek: string; // "2026-W24" — id 에서 prefix 제거
  date: Date;
  mode: string;
  deployFlag: "on" | "off" | null;
  candidateCount: number;
  selectedTitle: string | null;
  selectedScore: number | null;
  selectedChangeType: string | null;
  selectedOwner: string | null;
  prUrl: string | null;
  merged: boolean;
  needsHuman: boolean;
  reason: string | null;
  backlogTop3: BacklogCandidate[];
}

/** status 섹션 파생 데이터 (최신 cycle row + 서버 시각). */
export interface AutopilotStatus {
  mode: string | null; // 최신 row.mode, 없으면 null
  deployFlag: "on" | "off" | null; // 최신 row.deployFlag
  lastRunIsoWeek: string | null; // 최신 row.isoWeek, 없으면 null
  nextCycleLabel: string; // "6/9 (월)" — 서버 KST 계산
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/entities/autopilot-cycle/model/types.ts
git commit -m "feat(autopilot): entity 타입 정의"
```

---

## Task 3: Zod 입력 스키마 (`model/inputSchema.ts`)

cycle.workflow.js는 분기마다 다른 형태를 반환한다 (`no-candidate-selected` / `implementation-gate-failed` / 정상 PR). 입력 스키마는 이 합집합을 받아야 하므로 선정·PR 필드는 모두 optional/nullable.

**Files:**
- Create: `apps/dashboard/src/entities/autopilot-cycle/model/inputSchema.ts`
- Test: `apps/dashboard/tests/autopilot/inputSchema.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// apps/dashboard/tests/autopilot/inputSchema.test.ts
import { describe, it, expect } from "vitest";
import { AutopilotCycleInput } from "@/entities/autopilot-cycle/model/inputSchema";

describe("AutopilotCycleInput", () => {
  it("정상 사이클(PR 생성) 입력을 통과시킨다", () => {
    const r = AutopilotCycleInput.safeParse({
      id: "autopilot-2026-W24",
      date: "2026-06-09T00:00:00.000Z",
      mode: "shadow",
      deployFlag: "off",
      candidateCount: 12,
      selected: { title: "Next.js 16.3", owner: "dependency-security", score: 4.2, changeType: "deps" },
      prUrl: "https://github.com/krdn/gons-dashboard/pull/131",
      merged: false,
      needsHuman: false,
      backlogTop3: [{ title: "Zod v4", score: 3.9, dedupKey: "deps:zod-4" }],
      debate: { selected: null, backlogTop3: [] },
    });
    expect(r.success).toBe(true);
  });

  it("후보 미선정(selected=null, reason 있음) 입력을 통과시킨다", () => {
    const r = AutopilotCycleInput.safeParse({
      id: "autopilot-2026-W22",
      date: "2026-05-26T00:00:00.000Z",
      mode: "shadow",
      candidateCount: 0,
      selected: null,
      reason: "no-candidate-selected",
      backlogTop3: [],
    });
    expect(r.success).toBe(true);
  });

  it("id 누락 시 거부한다", () => {
    const r = AutopilotCycleInput.safeParse({ mode: "shadow", candidateCount: 0 });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

Run: `cd apps/dashboard && pnpm vitest run tests/autopilot/inputSchema.test.ts`
Expected: FAIL — "Cannot find module .../inputSchema"

- [ ] **Step 3: 스키마 구현**

```typescript
// entities/autopilot-cycle/model/inputSchema.ts
// cron 라우트가 POST 본문 검증에 사용. cycle.workflow.js 반환 합집합을 수용.
import { z } from "zod";

const BacklogCandidate = z.object({
  title: z.string(),
  score: z.number(),
  dedupKey: z.string(),
});

const DebateEntry = z.object({
  title: z.string(),
  owner: z.string(),
  score: z.number(),
  changeType: z.string(),
  dedupKey: z.string(),
  crossReview: z
    .array(
      z.object({
        challenge: z.string(),
        severity: z.enum(["low", "medium", "high"]),
        wouldBlock: z.boolean(),
      }),
    )
    .default([]),
  verdicts: z
    .array(
      z.object({
        valueScore: z.number(),
        safetyScore: z.number(),
        feasibilityScore: z.number(),
      }),
    )
    .default([]),
});

export const AutopilotCycleInput = z.object({
  id: z.string().min(1),
  date: z.string().datetime(),
  mode: z.string().min(1),
  deployFlag: z.enum(["on", "off"]).optional(),
  candidateCount: z.number().int().min(0),

  selected: z
    .object({
      title: z.string(),
      owner: z.string().optional(),
      score: z.number().optional(),
      changeType: z.string().optional(),
    })
    .nullable()
    .optional(),

  prUrl: z.string().url().nullable().optional(),
  merged: z.boolean().optional(),
  needsHuman: z.boolean().optional(),
  reason: z.string().nullable().optional(),

  backlogTop3: z.array(BacklogCandidate).default([]),
  debate: z
    .object({
      selected: DebateEntry.nullable(),
      backlogTop3: z.array(DebateEntry).default([]),
    })
    .nullable()
    .optional(),
});

export type AutopilotCycleInput = z.infer<typeof AutopilotCycleInput>;
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

Run: `cd apps/dashboard && pnpm vitest run tests/autopilot/inputSchema.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/entities/autopilot-cycle/model/inputSchema.ts apps/dashboard/tests/autopilot/inputSchema.test.ts
git commit -m "feat(autopilot): Zod 입력 스키마 + 테스트"
```

---

## Task 4: `recordCycle` (upsert)

**Files:**
- Create: `apps/dashboard/src/entities/autopilot-cycle/api/recordCycle.ts`
- Test: `apps/dashboard/tests/autopilot/recordCycle.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// apps/dashboard/tests/autopilot/recordCycle.test.ts
// 통합 테스트 — TEST_DATABASE_URL 필요 (메모리 Gotcha #2). DB 미연결 시 ECONNREFUSED skip OK.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { autopilotCycles } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { recordCycle } from "@/entities/autopilot-cycle/api/recordCycle";

const base = {
  id: "autopilot-2099-W01",
  date: "2099-01-05T00:00:00.000Z",
  mode: "shadow",
  candidateCount: 3,
  backlogTop3: [{ title: "x", score: 1, dedupKey: "x" }],
} as const;

describe("recordCycle", () => {
  beforeEach(async () => {
    await db.delete(autopilotCycles).where(eq(autopilotCycles.id, base.id));
  });

  it("같은 id로 두 번 호출해도 1 row이며 값이 갱신된다 (멱등 upsert)", async () => {
    await recordCycle({ ...base, candidateCount: 3 });
    await recordCycle({ ...base, candidateCount: 7, mode: "autonomous" });

    const rows = await db.select().from(autopilotCycles).where(eq(autopilotCycles.id, base.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].candidateCount).toBe(7);
    expect(rows[0].mode).toBe("autonomous");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/autopilot/recordCycle.test.ts`
Expected: FAIL — "Cannot find module .../recordCycle" (또는 DB 미기동 시 ECONNREFUSED). 로컬 테스트 DB는 CLAUDE.md Gotcha #2의 docker 명령으로 기동.

- [ ] **Step 3: 구현**

```typescript
// entities/autopilot-cycle/api/recordCycle.ts
import "server-only";
import { db } from "@/shared/lib/db/client";
import { autopilotCycles } from "@/shared/lib/db/schema";
import type { AutopilotCycleInput } from "../model/inputSchema";

function mapToRow(input: AutopilotCycleInput) {
  return {
    id: input.id,
    date: new Date(input.date),
    mode: input.mode,
    deployFlag: input.deployFlag ?? null,
    candidateCount: input.candidateCount,
    selectedTitle: input.selected?.title ?? null,
    selectedScore: input.selected?.score ?? null,
    selectedChangeType: input.selected?.changeType ?? null,
    selectedOwner: input.selected?.owner ?? null,
    prUrl: input.prUrl ?? null,
    merged: input.merged ?? false,
    needsHuman: input.needsHuman ?? false,
    reason: input.reason ?? null,
    backlogTop3: input.backlogTop3,
    debate: input.debate ?? null,
  };
}

export async function recordCycle(input: AutopilotCycleInput): Promise<void> {
  const row = mapToRow(input);
  await db
    .insert(autopilotCycles)
    .values(row)
    .onConflictDoUpdate({ target: autopilotCycles.id, set: row });
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/autopilot/recordCycle.test.ts`
Expected: PASS (로컬 테스트 DB 기동 시). DB 미연결이면 ECONNREFUSED — 그 경우 CLAUDE.md Gotcha #2 docker 명령으로 DB 띄우고 재실행.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/entities/autopilot-cycle/api/recordCycle.ts apps/dashboard/tests/autopilot/recordCycle.test.ts
git commit -m "feat(autopilot): recordCycle upsert + 통합 테스트"
```

---

## Task 5: 읽기 fn (`getCycles`, `getAutopilotView`)

**Files:**
- Create: `apps/dashboard/src/entities/autopilot-cycle/api/getCycles.ts`
- Create: `apps/dashboard/src/entities/autopilot-cycle/api/getAutopilotView.ts`

- [ ] **Step 1: getCycles 구현**

```typescript
// entities/autopilot-cycle/api/getCycles.ts
import "server-only";
import { db } from "@/shared/lib/db/client";
import { autopilotCycles } from "@/shared/lib/db/schema";
import { desc } from "drizzle-orm";
import type { AutopilotCycle } from "../model/types";

const HISTORY_LIMIT = 8;

function rowToCycle(row: typeof autopilotCycles.$inferSelect): AutopilotCycle {
  return {
    id: row.id,
    isoWeek: row.id.replace(/^autopilot-/, ""),
    date: row.date,
    mode: row.mode,
    deployFlag: (row.deployFlag as "on" | "off" | null) ?? null,
    candidateCount: row.candidateCount,
    selectedTitle: row.selectedTitle,
    selectedScore: row.selectedScore,
    selectedChangeType: row.selectedChangeType,
    selectedOwner: row.selectedOwner,
    prUrl: row.prUrl,
    merged: row.merged,
    needsHuman: row.needsHuman,
    reason: row.reason,
    backlogTop3: row.backlogTop3,
  };
}

/** 최근 사이클 N건 (createdAt desc). 조회 실패 시 빈 배열 — 위젯 graceful degrade. */
export async function getCycles(limit = HISTORY_LIMIT): Promise<AutopilotCycle[]> {
  return db
    .select()
    .from(autopilotCycles)
    .orderBy(desc(autopilotCycles.createdAt))
    .limit(limit)
    .then((rows) => rows.map(rowToCycle), () => []);
}
```

(주의: 메모리 react-error-boundaries-lint-rule — server async 에서 try/catch 안 JSX 금지. `.then(success, failure)` discriminated 패턴으로 빈 배열 폴백.)

- [ ] **Step 2: getAutopilotView 구현 (위젯 1회 조회)**

```typescript
// entities/autopilot-cycle/api/getAutopilotView.ts
import "server-only";
import { getCycles } from "./getCycles";
import type { AutopilotCycle, AutopilotStatus, BacklogCandidate } from "../model/types";

/** 다음 월요일 KST "M/D (월)" 라벨. 실제 cron 요일 확정 전 표시 가정 (주 1회 월요일). */
function nextMondayLabel(now: Date): string {
  // KST 기준 계산 — 서버 RSC (TZ=Asia/Seoul).
  const day = now.getDay(); // 0=일..6=토
  const daysUntilMon = (8 - day) % 7 || 7; // 다음 월요일까지 (오늘이 월이면 +7)
  const next = new Date(now.getTime() + daysUntilMon * 86400000);
  return `${next.getMonth() + 1}/${next.getDate()} (월)`;
}

export interface AutopilotView {
  cycles: AutopilotCycle[];
  latestBacklog: BacklogCandidate[];
  status: AutopilotStatus;
}

export async function getAutopilotView(now: Date): Promise<AutopilotView> {
  const cycles = await getCycles();
  const latest = cycles[0] ?? null;
  return {
    cycles,
    latestBacklog: latest?.backlogTop3 ?? [],
    status: {
      mode: latest?.mode ?? null,
      deployFlag: latest?.deployFlag ?? null,
      lastRunIsoWeek: latest?.isoWeek ?? null,
      nextCycleLabel: nextMondayLabel(now),
    },
  };
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/entities/autopilot-cycle/api/getCycles.ts apps/dashboard/src/entities/autopilot-cycle/api/getAutopilotView.ts
git commit -m "feat(autopilot): getCycles + getAutopilotView 읽기 fn"
```

---

## Task 6: entity barrel (server.ts + client.ts)

**Files:**
- Create: `apps/dashboard/src/entities/autopilot-cycle/server.ts`
- Create: `apps/dashboard/src/entities/autopilot-cycle/client.ts`

- [ ] **Step 1: server.ts**

```typescript
// autopilot-cycle entity — server-only entrypoint.
// recordCycle/getCycles/getAutopilotView 는 db(postgres) 의존 — client tree 누출 금지.
import "server-only";

export { recordCycle } from "./api/recordCycle";
export { getCycles } from "./api/getCycles";
export { getAutopilotView, type AutopilotView } from "./api/getAutopilotView";

export type {
  AutopilotCycle,
  AutopilotStatus,
  BacklogCandidate,
  DebateEntry,
  DebateLog,
  ChangeType,
} from "./model/types";
export { AutopilotCycleInput } from "./model/inputSchema";
```

- [ ] **Step 2: client.ts (타입만 — UI 컴포넌트는 widget 측에 둠)**

```typescript
// autopilot-cycle entity — client-safe entrypoint.
// "server-only" import 금지. 위젯 client 컴포넌트가 쓰는 타입만 노출.

export type {
  AutopilotCycle,
  AutopilotStatus,
  BacklogCandidate,
} from "./model/types";
```

- [ ] **Step 3: typecheck + lint (FSD boundary)**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS — eslint-plugin-boundaries 위반 없음

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/entities/autopilot-cycle/server.ts apps/dashboard/src/entities/autopilot-cycle/client.ts
git commit -m "feat(autopilot): entity server/client barrel"
```

---

## Task 7: 저장 cron 라우트

**Files:**
- Create: `apps/dashboard/src/app/api/cron/autopilot-cycle/route.ts`
- Test: `apps/dashboard/tests/autopilot/autopilot-cycle-route.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// apps/dashboard/tests/autopilot/autopilot-cycle-route.test.ts
import { describe, it, expect, vi } from "vitest";
import { AutopilotCycleInput } from "@/entities/autopilot-cycle/model/inputSchema";

// recordCycle 을 mock — 라우트의 인증·검증 분기만 테스트. (Input 스키마는 실제 것 사용.)
vi.mock("@/entities/autopilot-cycle/server", () => ({
  recordCycle: vi.fn().mockResolvedValue(undefined),
  AutopilotCycleInput,
}));

import { POST } from "@/app/api/cron/autopilot-cycle/route";

const TOKEN = process.env.CRON_BEARER_TOKEN ?? "test-token-test-token-test-token-1234";

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/cron/autopilot-cycle", {
    method: "POST",
    headers: auth ? { authorization: auth, "content-type": "application/json" } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const valid = {
  id: "autopilot-2099-W02",
  date: "2099-01-12T00:00:00.000Z",
  mode: "shadow",
  candidateCount: 0,
  selected: null,
  reason: "no-candidate-selected",
  backlogTop3: [],
};

describe("POST /api/cron/autopilot-cycle", () => {
  it("Bearer 누락 시 401", async () => {
    const res = await POST(req(valid));
    expect(res.status).toBe(401);
  });

  it("잘못된 body 시 400", async () => {
    const res = await POST(req({ mode: "shadow" }, `Bearer ${TOKEN}`));
    expect(res.status).toBe(400);
  });

  it("정상 입력 시 200", async () => {
    const res = await POST(req(valid, `Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

Run: `cd apps/dashboard && CRON_BEARER_TOKEN="test-token-test-token-test-token-1234" pnpm vitest run tests/autopilot/autopilot-cycle-route.test.ts`
Expected: FAIL — route 모듈 없음

- [ ] **Step 3: 라우트 구현 (autopilot-notify 패턴 미러)**

```typescript
// app/api/cron/autopilot-cycle/route.ts
// 주간 autopilot 사이클 결과를 DB 에 영속화하는 저장 전용 엔드포인트.
// 호출자: 주간 /schedule 원격 에이전트 (cycle.workflow.js 반환값을 그대로 POST).
// 인증: verifyCronBearer (실패 시 401). 검증: Zod (실패 시 400).
import { NextResponse } from "next/server";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { recordCycle, AutopilotCycleInput } from "@/entities/autopilot-cycle/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyCronBearer(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = AutopilotCycleInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad-request", issues: parsed.error.issues }, { status: 400 });
  }

  await recordCycle(parsed.data);
  return NextResponse.json({ status: "ok", id: parsed.data.id });
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

Run: `cd apps/dashboard && CRON_BEARER_TOKEN="test-token-test-token-test-token-1234" pnpm vitest run tests/autopilot/autopilot-cycle-route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/cron/autopilot-cycle/route.ts apps/dashboard/tests/autopilot/autopilot-cycle-route.test.ts
git commit -m "feat(autopilot): 저장 전용 cron 라우트 + 테스트"
```

---

## Task 8: 위젯 client 컴포넌트 (Status, History, Candidates, Skeleton)

**Files:**
- Create: `apps/dashboard/src/widgets/autopilot/ui/AutopilotStatus.tsx`
- Create: `apps/dashboard/src/widgets/autopilot/ui/CycleHistoryList.tsx`
- Create: `apps/dashboard/src/widgets/autopilot/ui/NextCandidates.tsx`
- Create: `apps/dashboard/src/widgets/autopilot/ui/AutopilotSkeleton.tsx`
- Test: `apps/dashboard/tests/autopilot/widget-render.test.ts`

- [ ] **Step 1: AutopilotStatus (client)**

```tsx
"use client";
import type { AutopilotStatus as Status } from "@/entities/autopilot-cycle/client";

export function AutopilotStatus({ status }: { status: Status }) {
  const modeLabel = status.mode ?? "shadow";
  const deployLabel = status.deployFlag === "on" ? "배포 ON" : status.deployFlag === "off" ? "배포 OFF" : "배포 미상";
  return (
    <div className="flex items-center justify-between">
      <strong className="text-sm font-semibold">🤖 Autopilot — 주간 자율 업그레이드</strong>
      <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
        {modeLabel} · {deployLabel}
      </span>
    </div>
  );
}

export function AutopilotMeta({ status }: { status: Status }) {
  return (
    <div className="mt-2 flex gap-4 text-xs text-[var(--color-text-muted)]">
      <span>다음 사이클 · <b className="text-[var(--color-text)]">{status.nextCycleLabel}</b></span>
      <span>마지막 실행 · <b className="text-[var(--color-text)]">{status.lastRunIsoWeek ?? "없음"}</b></span>
    </div>
  );
}
```

- [ ] **Step 2: CycleHistoryList (client) — empty state 포함**

```tsx
"use client";
import type { AutopilotCycle } from "@/entities/autopilot-cycle/client";

function statusBadge(c: AutopilotCycle): { text: string; cls: string } {
  if (c.reason) return { text: c.reason, cls: "text-[var(--color-text-subtle)]" };
  if (c.merged) return { text: "✓머지", cls: "text-[var(--color-text-muted)]" };
  if (c.needsHuman) return { text: "⚠needs-human", cls: "text-[var(--color-warn)]" };
  return { text: "PR 생성", cls: "text-[var(--color-text-muted)]" };
}

export function CycleHistoryList({ cycles }: { cycles: AutopilotCycle[] }) {
  if (cycles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] py-5 text-center text-xs text-[var(--color-text-subtle)]">
        첫 사이클이 아직 실행되지 않았습니다 · shadow 모드로 대기 중
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {cycles.map((c) => {
        const badge = statusBadge(c);
        return (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs text-[var(--color-text-subtle)]">{c.isoWeek}</span>
              <span className="truncate">{c.selectedTitle ?? "(후보 선정 안 됨)"}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs">
              {c.selectedScore != null && <span className="tabular-nums text-[var(--color-text-muted)]">score {c.selectedScore.toFixed(1)}</span>}
              {c.prUrl ? (
                <a href={c.prUrl} target="_blank" rel="noopener noreferrer" className={`${badge.cls} hover:underline`}>{badge.text}</a>
              ) : (
                <span className={badge.cls}>{badge.text}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: NextCandidates (client) — empty state 포함**

```tsx
"use client";
import type { BacklogCandidate } from "@/entities/autopilot-cycle/client";

export function NextCandidates({ candidates }: { candidates: BacklogCandidate[] }) {
  if (candidates.length === 0) {
    return (
      <p className="py-2 text-xs italic text-[var(--color-text-subtle)]">
        사이클이 토론을 거쳐 후보를 선정하면 여기에 TOP 3가 표시됩니다
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {candidates.map((b) => (
        <li key={b.dedupKey} className="flex items-center justify-between gap-2">
          <span className="truncate">· {b.title}</span>
          <span className="shrink-0 tabular-nums text-xs text-[var(--color-text-muted)]">score {b.score.toFixed(1)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: AutopilotSkeleton (client)**

```tsx
export function AutopilotSkeleton() {
  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <div className="mb-3 h-5 w-56 animate-pulse rounded bg-zinc-200" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-4 w-full animate-pulse rounded bg-[var(--color-surface-2)]" />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: UI 단위 테스트 (empty state + 조건부 PR 링크)**

```typescript
// apps/dashboard/tests/autopilot/widget-render.test.ts
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CycleHistoryList } from "@/widgets/autopilot/ui/CycleHistoryList";
import { NextCandidates } from "@/widgets/autopilot/ui/NextCandidates";
import type { AutopilotCycle } from "@/entities/autopilot-cycle/client";

const cycle = (over: Partial<AutopilotCycle>): AutopilotCycle => ({
  id: "autopilot-2026-W23", isoWeek: "2026-W23", date: new Date(), mode: "shadow",
  deployFlag: "off", candidateCount: 5, selectedTitle: "Next 16.3", selectedScore: 4.2,
  selectedChangeType: "deps", selectedOwner: "dependency-security",
  prUrl: "https://github.com/krdn/gons-dashboard/pull/131", merged: true, needsHuman: false,
  reason: null, backlogTop3: [], ...over,
});

describe("CycleHistoryList", () => {
  it("이력 0건이면 empty state를 보여준다", () => {
    render(<CycleHistoryList cycles={[]} />);
    expect(screen.getByText(/첫 사이클이 아직 실행되지 않았습니다/)).toBeTruthy();
  });

  it("prUrl이 있으면 링크로 렌더한다", () => {
    render(<CycleHistoryList cycles={[cycle({})]} />);
    const link = screen.getByText("✓머지").closest("a");
    expect(link?.getAttribute("href")).toContain("/pull/131");
  });

  it("prUrl이 없으면 링크 대신 텍스트로 렌더한다", () => {
    render(<CycleHistoryList cycles={[cycle({ prUrl: null, merged: false, reason: "implementation-gate-failed" })]} />);
    expect(screen.getByText("implementation-gate-failed").closest("a")).toBeNull();
  });
});

describe("NextCandidates", () => {
  it("후보 0건이면 empty state를 보여준다", () => {
    render(<NextCandidates candidates={[]} />);
    expect(screen.getByText(/여기에 TOP 3가 표시됩니다/)).toBeTruthy();
  });
});
```

- [ ] **Step 6: 테스트 실행 (통과 확인)**

Run: `cd apps/dashboard && pnpm vitest run tests/autopilot/widget-render.test.ts`
Expected: PASS (4 tests). (참고: 기존 위젯 테스트가 @testing-library/react 를 쓰는지 먼저 확인 — `grep -rl "@testing-library/react" apps/dashboard/tests/`. 없으면 같은 패턴의 기존 UI 테스트 파일 import 방식을 따른다.)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/widgets/autopilot/ui/ apps/dashboard/tests/autopilot/widget-render.test.ts
git commit -m "feat(autopilot): 위젯 client 컴포넌트 (status/history/candidates/skeleton)"
```

---

## Task 9: AutopilotCard (RSC) + widget barrel

**Files:**
- Create: `apps/dashboard/src/widgets/autopilot/ui/AutopilotCard.tsx`
- Create: `apps/dashboard/src/widgets/autopilot/index.ts`

- [ ] **Step 1: AutopilotCard (RSC)**

```tsx
import "server-only";
import { getAutopilotView } from "@/entities/autopilot-cycle/server";
import { AutopilotStatus, AutopilotMeta } from "./AutopilotStatus";
import { CycleHistoryList } from "./CycleHistoryList";
import { NextCandidates } from "./NextCandidates";

export async function AutopilotCard() {
  // 서버 RSC — TZ=Asia/Seoul. now 를 주입해 nextCycleLabel KST 계산.
  const view = await getAutopilotView(new Date());

  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4 text-[var(--color-text)]">
      <AutopilotStatus status={view.status} />
      <AutopilotMeta status={view.status} />

      <div className="mt-3 border-t border-[var(--color-hairline)] pt-3">
        <div className="mb-1.5 text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">사이클 이력</div>
        <CycleHistoryList cycles={view.cycles} />
      </div>

      <div className="mt-3 border-t border-[var(--color-hairline)] pt-3">
        <div className="mb-1.5 text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">다음 후보 (backlog)</div>
        <NextCandidates candidates={view.latestBacklog} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: widget barrel**

```typescript
export { AutopilotCard } from "./ui/AutopilotCard";
export { AutopilotSkeleton } from "./ui/AutopilotSkeleton";
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/autopilot/ui/AutopilotCard.tsx apps/dashboard/src/widgets/autopilot/index.ts
git commit -m "feat(autopilot): AutopilotCard RSC + widget barrel"
```

---

## Task 10: 대시보드 페이지 배치 + 최종 검증

**Files:**
- Modify: `apps/dashboard/src/app/page.tsx`

- [ ] **Step 1: import 추가**

`apps/dashboard/src/app/page.tsx` 의 위젯 import 블록(StockAnalysis import 아래)에 추가:

```tsx
import { AutopilotCard, AutopilotSkeleton } from "@/widgets/autopilot";
```

- [ ] **Step 2: 좌측 메인 컬럼에 배치 (StockAnalysisCard Suspense 아래)**

`<StockAnalysisCard />` 의 `</Suspense>` 바로 다음에 추가:

```tsx
          <Suspense fallback={<AutopilotSkeleton />}>
            <AutopilotCard />
          </Suspense>
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: build 검증 (server-only 누수 — Gotcha #7)**

Run: `cd apps/dashboard && pnpm build`
Expected: SUCCESS — `Module not found: Can't resolve 'tls'/'net'/'perf_hooks'` 없음. client 컴포넌트가 entity client barrel만 import하는지 이 단계에서 확정.

- [ ] **Step 5: 전체 autopilot 테스트**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/autopilot/`
Expected: PASS (inputSchema 3 + route 3 + widget 4 = 10; recordCycle 1은 로컬 DB 기동 시)

- [ ] **Step 6: 수동 동작 확인 (선택 — 로컬 dev)**

```bash
# dev 서버 기동 후, 저장 라우트에 샘플 POST → 위젯에 row 표시 확인
curl -s -X POST http://localhost:3020/api/cron/autopilot-cycle \
  -H "Authorization: Bearer $CRON_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"autopilot-2026-W23","date":"2026-06-02T00:00:00.000Z","mode":"shadow","deployFlag":"off","candidateCount":5,"selected":{"title":"테스트 후보","owner":"dependency-security","score":4.2,"changeType":"deps"},"prUrl":null,"merged":false,"needsHuman":false,"backlogTop3":[{"title":"다음 후보 A","score":3.8,"dedupKey":"a"}]}'
# → {"status":"ok","id":"autopilot-2026-W23"}. 대시보드 새로고침 시 이력·후보 표시.
```

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/page.tsx
git commit -m "feat(autopilot): 대시보드에 autopilot 위젯 배치"
```

---

## 완료 기준

- `pnpm typecheck && pnpm lint` PASS
- `cd apps/dashboard && pnpm build` SUCCESS (server-only 누수 없음)
- `tests/autopilot/` 전체 PASS (DB 기동 시 recordCycle 포함)
- empty state(이력 0건)에서 위젯이 깨지지 않고 "대기 중" 표시
- 샘플 POST 후 이력·후보 row 표시

## 범위 밖 (별도 작업)

- 주간 `/schedule` 에이전트가 이 라우트를 실제 호출하도록 배선 → 메모리 autopilot-status-pr126 Task 12·13 (운영 접근 필요)
- debate 전문(crossReview/verdicts) 상세 UI
- 운영 준비도 체크리스트 (docker socket 권한 등)
- 운영 DB 마이그레이션 적용 (메모리 drizzle-kit-migrate-prod-broken — psql 직접 BEGIN/COMMIT)
