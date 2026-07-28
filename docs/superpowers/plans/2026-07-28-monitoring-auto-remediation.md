# 관제 자동 복구 (auto-remediation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** open 상태로 오래 남은 관제 이벤트에 대해 화이트리스트 조치를 자동 실행하고, 모든 시도를 감사 기록한다.

**Architecture:** `apps/cron` 이 5분마다 `/api/cron/auto-remediate` 를 호출한다. 판정은 순수 함수(`selectActions`, `guards`)로 분리해 DB·docker 없이 테스트하고, 실행은 기존 `runDocker` 를 경유한다. 동시 실행은 `remediation_attempts` 의 부분 unique index 로 DB 가 중재한다.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, PostgreSQL 16, Vitest, node-cron

**설계 스펙:** `docs/superpowers/specs/2026-07-28-monitoring-auto-remediation-design.md`
**이슈:** #352

## Global Constraints

- 조치 조건은 **실측값만** 사용한다. 이름·prefix·관례를 조건에 넣지 않는다.
- Phase 1 은 dry-run 기본값이다. `AUTO_REMEDIATE_ENABLED` 가 없거나 `false` 면 실행하지 않는다.
- 모든 시도는 `remediation_attempts` 에 기록한다. skip 도 기록한다 (사유 포함).
- 순수 함수(`lib/*`)는 DB·docker·시각을 직접 참조하지 않는다. `now` 는 인자로 받는다.
- 커밋 메시지는 한국어, `~/.claude/rules/korean-response.md` 컨벤션을 따른다.
- 검증: `pnpm typecheck && pnpm lint`. 통합 테스트는 `TEST_DATABASE_URL` 필요.

---

### Task 1: `remediation_attempts` 테이블

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/monitoring.ts`
- Create: `apps/dashboard/drizzle/<generated>.sql` (db:generate 산출물)

**Interfaces:**
- Consumes: 없음
- Produces: `remediationAttempts` 테이블. 컬럼 — `id`, `eventId`, `dedupKey`, `policyId`, `action`, `dryRun`, `outcome`, `reason`, `detail`, `attemptedAt`, `settledAt`

- [ ] **Step 1: 스키마 추가**

`monitoring.ts` 끝에 추가한다. `monitoringEvents` 의 부분 unique index 패턴을 그대로 미러한다.

```ts
export const remediationAttempts = pgTable(
  "remediation_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => monitoringEvents.id, {
      onDelete: "cascade",
    }),
    // 시도 횟수·쿨다운 집계 키 (monitoring_events.dedup_key 와 동일 값)
    dedupKey: text("dedup_key").notNull(),
    policyId: text("policy_id").notNull(),
    // 'restart-container' | 'prune-images' | 'raise-redis-maxmemory'
    action: text("action").notNull(),
    dryRun: boolean("dry_run").notNull().default(true),
    // 'in_flight' | 'executed' | 'skipped' | 'failed'
    outcome: text("outcome").notNull(),
    // skip·실패 사유. 판단 근거 추적용.
    reason: text("reason"),
    // 조치 시점의 실측값 스냅샷 — 사후 오탐 분석의 근거.
    detail: text("detail"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("remediation_attempts_dedup_idx").on(t.dedupKey, t.attemptedAt.desc()),
    // 같은 dedupKey 로 in-flight 시도는 하나만 — cron 주기보다 조치가 길 때
    // 중복 실행으로 복구 중 서비스를 다시 죽이는 것을 DB 레벨에서 차단한다.
    // monitoring_events_open_dedup_uq 와 같은 패턴.
    uniqueIndex("remediation_in_flight_uq")
      .on(t.dedupKey)
      .where(sql`outcome = 'in_flight'`),
  ],
);
```

`boolean` 이 import 되어 있지 않으면 파일 상단 `drizzle-orm/pg-core` import 에 추가한다.

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `apps/dashboard/drizzle/` 에 새 `.sql` 파일 생성. 내용에 `CREATE TABLE "remediation_attempts"` 와 `CREATE UNIQUE INDEX "remediation_in_flight_uq"` 가 포함되어야 한다.

- [ ] **Step 3: 로컬 테스트 DB 에 적용해 검증**

```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine
cd apps/dashboard && DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm db:migrate
```

Expected: `migrations applied successfully`

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: 통과

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/shared/lib/db/schema/monitoring.ts apps/dashboard/drizzle/
git commit -m "feat: remediation_attempts 테이블 추가

자동 복구 시도의 감사 기록 + 쿨다운 판정 근거. in-flight 부분 unique
index 로 같은 대상에 대한 조치 중복 실행을 DB 레벨에서 차단한다."
```

---

### Task 2: 안전장치 순수 함수 (`guards.ts`)

**Files:**
- Create: `apps/dashboard/src/features/monitoring-remediate/lib/guards.ts`
- Test: `apps/dashboard/tests/unit/remediationGuards.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `MIN_OPEN_MINUTES: Record<"critical" | "warning", number>`
  - `type AttemptSummary = { outcome: string; attemptedAt: Date }`
  - `type GuardInput = { severity: string; occurredAt: Date; maxAttempts: number; cooldownMinutes: number; history: AttemptSummary[]; now: Date }`
  - `type GuardVerdict = { allowed: true } | { allowed: false; reason: string }`
  - `evaluateGuards(input: GuardInput): GuardVerdict`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/tests/unit/remediationGuards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  evaluateGuards,
  MIN_OPEN_MINUTES,
} from "@/features/monitoring-remediate/lib/guards";

const NOW = new Date("2026-07-28T12:00:00Z");
const base = {
  severity: "critical",
  occurredAt: new Date("2026-07-28T10:00:00Z"), // 120분 전
  maxAttempts: 3,
  cooldownMinutes: 60,
  history: [] as { outcome: string; attemptedAt: Date }[],
  now: NOW,
};

describe("evaluateGuards", () => {
  it("조건을 모두 만족하면 허용", () => {
    expect(evaluateGuards(base)).toEqual({ allowed: true });
  });

  // 이벤트 278건 중 86%가 평균 0.1h 에 자해소한다. 지속시간 게이트가
  // 그 대다수를 조치 대상에서 제외하는 것이 이 설계의 1차 방어선이다.
  it("최소 지속 시간 미달이면 거부", () => {
    const v = evaluateGuards({
      ...base,
      occurredAt: new Date("2026-07-28T11:45:00Z"), // 15분 전 < 30분
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("지속") });
  });

  it("warning 은 critical 보다 긴 지속을 요구", () => {
    const oneHourAgo = new Date("2026-07-28T11:00:00Z");
    expect(evaluateGuards({ ...base, severity: "critical", occurredAt: oneHourAgo }).allowed).toBe(true);
    expect(evaluateGuards({ ...base, severity: "warning", occurredAt: oneHourAgo }).allowed).toBe(false);
  });

  it("시도 횟수 상한 초과면 거부", () => {
    const v = evaluateGuards({
      ...base,
      history: [
        { outcome: "executed", attemptedAt: new Date("2026-07-25T00:00:00Z") },
        { outcome: "executed", attemptedAt: new Date("2026-07-26T00:00:00Z") },
        { outcome: "failed", attemptedAt: new Date("2026-07-27T00:00:00Z") },
      ],
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("시도") });
  });

  it("skipped 는 시도 횟수에 포함하지 않는다", () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      outcome: "skipped",
      attemptedAt: new Date(`2026-07-2${i + 1}T00:00:00Z`),
    }));
    expect(evaluateGuards({ ...base, history }).allowed).toBe(true);
  });

  it("쿨다운 중이면 거부", () => {
    const v = evaluateGuards({
      ...base,
      history: [{ outcome: "executed", attemptedAt: new Date("2026-07-28T11:30:00Z") }], // 30분 전 < 60분
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("쿨다운") });
  });

  it("in_flight 가 있으면 거부", () => {
    const v = evaluateGuards({
      ...base,
      history: [{ outcome: "in_flight", attemptedAt: new Date("2026-07-28T11:59:00Z") }],
    });
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: expect.stringContaining("실행 중") });
  });

  it("MIN_OPEN_MINUTES 는 critical 30분 / warning 6시간", () => {
    expect(MIN_OPEN_MINUTES.critical).toBe(30);
    expect(MIN_OPEN_MINUTES.warning).toBe(360);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/unit/remediationGuards.test.ts`
Expected: FAIL — `Failed to resolve import ".../guards"`

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/monitoring-remediate/lib/guards.ts`:

```ts
// 자동 복구 안전장치 — 순수 함수 (이슈 #352).
//
// DB·docker·현재시각을 참조하지 않는다. now 를 인자로 받아 테스트가 시간을
// 통제할 수 있게 한다 (judgeDatastoreStats 와 같은 방침).

/**
 * 조치 전 최소 open 지속 시간 (분).
 *
 * 실측 근거 (2026-07-28, monitoring_events 278건): 240건(86%)이 평균 0.1h
 * 에 자해소한다. 발생 즉시 조치하면 이미 끝난 상황에 손대 새 장애를 만든다.
 * 사람 손이 필요했던 것은 critical 평균 16.1h, security warning 119h 였다.
 */
export const MIN_OPEN_MINUTES: Record<string, number> = {
  critical: 30,
  warning: 360,
};

/** 알 수 없는 severity 는 가장 보수적인 값을 적용한다. */
const FALLBACK_MIN_OPEN_MINUTES = 360;

/** 시도 횟수에 산입하는 outcome — skipped 는 조치를 하지 않았으므로 제외. */
const COUNTED_OUTCOMES = new Set(["executed", "failed"]);

export type AttemptSummary = { outcome: string; attemptedAt: Date };

export type GuardInput = {
  severity: string;
  occurredAt: Date;
  maxAttempts: number;
  cooldownMinutes: number;
  history: AttemptSummary[];
  now: Date;
};

export type GuardVerdict = { allowed: true } | { allowed: false; reason: string };

function minutesBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 60_000;
}

export function evaluateGuards(input: GuardInput): GuardVerdict {
  // in-flight 가 있으면 다른 사이클이 실행 중 — DB claim 이 최종 방어선이지만
  // 여기서 먼저 걸러 불필요한 INSERT 시도를 줄인다.
  if (input.history.some((h) => h.outcome === "in_flight")) {
    return { allowed: false, reason: "이미 실행 중인 시도가 있음" };
  }

  const openMinutes = minutesBetween(input.now, input.occurredAt);
  const required = MIN_OPEN_MINUTES[input.severity] ?? FALLBACK_MIN_OPEN_MINUTES;
  if (openMinutes < required) {
    return {
      allowed: false,
      reason: `지속 시간 부족 (${Math.round(openMinutes)}분 < ${required}분)`,
    };
  }

  const counted = input.history.filter((h) => COUNTED_OUTCOMES.has(h.outcome));
  if (counted.length >= input.maxAttempts) {
    return {
      allowed: false,
      reason: `시도 횟수 상한 도달 (${counted.length}/${input.maxAttempts})`,
    };
  }

  const lastAttempt = counted.reduce<Date | null>(
    (max, h) => (max == null || h.attemptedAt > max ? h.attemptedAt : max),
    null,
  );
  if (lastAttempt != null) {
    const sinceLast = minutesBetween(input.now, lastAttempt);
    if (sinceLast < input.cooldownMinutes) {
      return {
        allowed: false,
        reason: `쿨다운 중 (${Math.round(sinceLast)}분 < ${input.cooldownMinutes}분)`,
      };
    }
  }

  return { allowed: true };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/unit/remediationGuards.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/monitoring-remediate/lib/guards.ts apps/dashboard/tests/unit/remediationGuards.test.ts
git commit -m "feat: 자동 복구 안전장치 순수 함수

지속시간·시도횟수·쿨다운·in-flight 4종 게이트. 지속시간 게이트가 자해소
이벤트 86%를 조치 대상에서 제외하는 1차 방어선이다."
```

---

### Task 3: 정책 선언 (`policies.ts`)

**Files:**
- Create: `apps/dashboard/src/features/monitoring-remediate/config/policies.ts`
- Test: `apps/dashboard/tests/unit/remediationPolicies.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type RemediationAction` (3종 union)
  - `type OpenEventView = { id: string; dedupKey: string; severity: string; source: string; title: string; detail: string | null; occurredAt: Date; hostId: string | null }`
  - `type RemediationPolicy = { id: string; maxAttempts: number; cooldownMinutes: number; buildAction: (e: OpenEventView, facts: LiveFacts) => RemediationAction | { skip: string } }`
  - `type LiveFacts = { hostAvailableMemBytes: number | null; containerExcluded: (name: string) => boolean }`
  - `POLICIES: readonly RemediationPolicy[]`
  - `RESTART_EXCLUDED: readonly string[]`
  - `REDIS_MAX_CAP_BYTES: number`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/tests/unit/remediationPolicies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  POLICIES,
  RESTART_EXCLUDED,
  REDIS_MAX_CAP_BYTES,
  type OpenEventView,
  type LiveFacts,
} from "@/features/monitoring-remediate/config/policies";

const facts: LiveFacts = {
  hostAvailableMemBytes: 13 * 1024 ** 3,
  containerExcluded: (n) => RESTART_EXCLUDED.some((x) => n.includes(x)),
};

function ev(over: Partial<OpenEventView>): OpenEventView {
  return {
    id: "e1",
    dedupKey: "k1",
    severity: "critical",
    source: "host",
    title: "t",
    detail: null,
    occurredAt: new Date("2026-07-28T10:00:00Z"),
    hostId: "h1",
    ...over,
  };
}

describe("redis maxmemory 정책", () => {
  const policy = POLICIES.find((p) => p.id === "redis-maxmemory")!;

  it("noeviction + 임계 초과면 상향 조치 생성", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 78,
          evictionPolicy: "noeviction",
          maxMemBytes: 1073741824,
          target: "ais-prod",
        }),
      }),
      facts,
    );
    expect(action).toMatchObject({ kind: "raise-redis-maxmemory", target: "ais-prod" });
    expect((action as { nextBytes: number }).nextBytes).toBe(2 * 1073741824);
  });

  // 수동 복구에서 얻은 교훈: 호스트 여유를 확인하지 않고 상한을 올리면
  // 호스트 자체가 OOM 에 빠진다. 실측값 없이는 조치하지 않는다.
  it("호스트 여유 메모리를 모르면 skip", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 78,
          evictionPolicy: "noeviction",
          maxMemBytes: 1073741824,
          target: "ais-prod",
        }),
      }),
      { ...facts, hostAvailableMemBytes: null },
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("여유") });
  });

  it("증가분이 호스트 여유를 넘으면 skip", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 78,
          evictionPolicy: "noeviction",
          maxMemBytes: 1073741824,
          target: "ais-prod",
        }),
      }),
      { ...facts, hostAvailableMemBytes: 100 * 1024 ** 2 },
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("여유") });
  });

  it("절대 상한 캡을 넘으면 skip", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 95,
          evictionPolicy: "noeviction",
          maxMemBytes: REDIS_MAX_CAP_BYTES,
          target: "ais-prod",
        }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("상한") });
  });

  it("allkeys-lru 는 대상 아님 (축출로 정상 동작)", () => {
    const action = policy.buildAction(
      ev({
        detail: JSON.stringify({
          usedPct: 95,
          evictionPolicy: "allkeys-lru",
          maxMemBytes: 1073741824,
          target: "n8n",
        }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.any(String) });
  });

  it("detail 이 JSON 이 아니면 skip (실측값 없이 조치 금지)", () => {
    const action = policy.buildAction(ev({ detail: "not json" }), facts);
    expect(action).toMatchObject({ skip: expect.any(String) });
  });
});

describe("컨테이너 재시작 정책", () => {
  const policy = POLICIES.find((p) => p.id === "restart-container")!;

  it("제외목록 컨테이너는 skip", () => {
    const action = policy.buildAction(
      ev({
        source: "container",
        detail: JSON.stringify({ containerName: "gons-dashboard-postgres", containerId: "abc123def456" }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.stringContaining("제외") });
  });

  it("일반 컨테이너는 재시작 조치 생성", () => {
    const action = policy.buildAction(
      ev({
        source: "container",
        detail: JSON.stringify({ containerName: "some-web", containerId: "abc123def456" }),
      }),
      facts,
    );
    expect(action).toMatchObject({ kind: "restart-container", containerName: "some-web" });
  });

  it("containerId 형식이 hex 가 아니면 skip (path traversal 방어)", () => {
    const action = policy.buildAction(
      ev({
        source: "container",
        detail: JSON.stringify({ containerName: "x", containerId: "../../etc/passwd" }),
      }),
      facts,
    );
    expect(action).toMatchObject({ skip: expect.any(String) });
  });
});

describe("정책 공통", () => {
  it("모든 정책은 maxAttempts 와 cooldownMinutes 를 갖는다", () => {
    for (const p of POLICIES) {
      expect(p.maxAttempts).toBeGreaterThan(0);
      expect(p.cooldownMinutes).toBeGreaterThan(0);
    }
  });

  it("정책 id 는 유일하다", () => {
    const ids = POLICIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("상태 보유 서비스가 재시작 제외목록에 있다", () => {
    expect(RESTART_EXCLUDED).toContain("postgres");
    expect(RESTART_EXCLUDED).toContain("redis");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/unit/remediationPolicies.test.ts`
Expected: FAIL — import 해결 실패

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/monitoring-remediate/config/policies.ts`:

```ts
// 자동 복구 정책 선언 (이슈 #352).
//
// ⚠️ 핵심 제약: 조치 조건은 **실측값만** 쓴다. 이름·prefix·관례를 조건에
// 넣지 않는다. 2026-07-28 수동 복구에서 두 판단이 그럴듯했지만 틀렸다 —
// Redis 키를 prefix 로 "dev 잔재" 라 판단했으나 활성 독자가 있었고,
// 5433 을 "0.0.0.0 이라 위험" 이라 판단했으나 아키텍처상 필수였다.
// 실측값이 없으면 조치하지 않고 skip 한다.

/** 재시작 시 데이터 손실·작업 유실 위험이 있는 서비스 (부분 문자열 매칭). */
export const RESTART_EXCLUDED: readonly string[] = [
  "postgres",
  "redis",
  "mongodb",
  "timescaledb",
];

/** Redis maxmemory 절대 상한 — 이 이상은 사람이 판단한다. */
export const REDIS_MAX_CAP_BYTES = 4 * 1024 ** 3;

/** Docker container ID 형식 (short=12, full=64). path traversal 방어. */
const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/;

export type RemediationAction =
  | { kind: "restart-container"; hostId: string; containerId: string; containerName: string }
  | { kind: "prune-images"; hostId: string }
  | { kind: "raise-redis-maxmemory"; hostId: string; target: string; nextBytes: number };

export type OpenEventView = {
  id: string;
  dedupKey: string;
  severity: string;
  source: string;
  title: string;
  detail: string | null;
  occurredAt: Date;
  hostId: string | null;
};

/** 조치 직전 실측한 사실. 선언 시점의 가정을 신뢰하지 않는다. */
export type LiveFacts = {
  /** 호스트 가용 메모리. 관측 실패 시 null — 그 경우 메모리 조치는 skip. */
  hostAvailableMemBytes: number | null;
  containerExcluded: (containerName: string) => boolean;
};

export type BuildResult = RemediationAction | { skip: string };

export type RemediationPolicy = {
  id: string;
  maxAttempts: number;
  cooldownMinutes: number;
  buildAction: (event: OpenEventView, facts: LiveFacts) => BuildResult;
};

function parseDetail(detail: string | null): Record<string, unknown> | null {
  if (detail == null) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return typeof parsed === "object" && parsed != null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const restartContainer: RemediationPolicy = {
  id: "restart-container",
  maxAttempts: 2,
  cooldownMinutes: 30,
  buildAction: (event, facts) => {
    if (event.hostId == null) return { skip: "hostId 없음" };
    const d = parseDetail(event.detail);
    if (d == null) return { skip: "detail 파싱 불가 — 실측값 없이 조치 금지" };

    const name = typeof d.containerName === "string" ? d.containerName : null;
    const id = typeof d.containerId === "string" ? d.containerId : null;
    if (name == null || id == null) return { skip: "컨테이너 식별자 누락" };
    if (!CONTAINER_ID_RE.test(id)) return { skip: "containerId 형식 불일치" };
    if (facts.containerExcluded(name)) {
      return { skip: `재시작 제외목록 대상 (${name})` };
    }

    return { kind: "restart-container", hostId: event.hostId, containerId: id, containerName: name };
  },
};

const pruneImages: RemediationPolicy = {
  id: "prune-images",
  maxAttempts: 1,
  cooldownMinutes: 24 * 60,
  buildAction: (event) => {
    if (event.hostId == null) return { skip: "hostId 없음" };
    const d = parseDetail(event.detail);
    if (d == null) return { skip: "detail 파싱 불가 — 실측값 없이 조치 금지" };
    const pct = typeof d.usedPct === "number" ? d.usedPct : null;
    if (pct == null) return { skip: "디스크 사용률 관측값 없음" };
    if (pct < 85) return { skip: `임계 미달 (${pct}% < 85%)` };
    return { kind: "prune-images", hostId: event.hostId };
  },
};

const redisMaxmemory: RemediationPolicy = {
  id: "redis-maxmemory",
  maxAttempts: 2,
  cooldownMinutes: 6 * 60,
  buildAction: (event, facts) => {
    if (event.hostId == null) return { skip: "hostId 없음" };
    const d = parseDetail(event.detail);
    if (d == null) return { skip: "detail 파싱 불가 — 실측값 없이 조치 금지" };

    // noeviction 이 아니면 상한 도달 시 축출로 정상 동작한다 — 조치 불필요.
    if (d.evictionPolicy !== "noeviction") {
      return { skip: `noeviction 아님 (${String(d.evictionPolicy)})` };
    }
    const target = typeof d.target === "string" ? d.target : null;
    const maxMem = typeof d.maxMemBytes === "number" ? d.maxMemBytes : null;
    if (target == null || maxMem == null || maxMem <= 0) {
      return { skip: "target/maxMemBytes 관측값 없음" };
    }

    const nextBytes = maxMem * 2;
    if (nextBytes > REDIS_MAX_CAP_BYTES) {
      return { skip: `절대 상한 초과 (${nextBytes} > ${REDIS_MAX_CAP_BYTES})` };
    }
    // 호스트 여유를 모르면 조치하지 않는다 — 상한만 올리다 호스트가 OOM 난다.
    const avail = facts.hostAvailableMemBytes;
    const delta = nextBytes - maxMem;
    if (avail == null || avail < delta * 2) {
      return { skip: `호스트 여유 메모리 부족/불명 (필요 ${delta * 2}, 가용 ${String(avail)})` };
    }

    return { kind: "raise-redis-maxmemory", hostId: event.hostId, target, nextBytes };
  },
};

export const POLICIES: readonly RemediationPolicy[] = [
  restartContainer,
  pruneImages,
  redisMaxmemory,
];
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/unit/remediationPolicies.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/monitoring-remediate/config/policies.ts apps/dashboard/tests/unit/remediationPolicies.test.ts
git commit -m "feat: 자동 복구 정책 선언

조치 3종(컨테이너 재시작·이미지 정리·Redis 상한 상향)의 트리거와 사전
조건. 실측값이 없으면 조치하지 않고 skip 한다 — 2026-07-28 수동 복구의
두 오판(prefix 기반 판단, 표면 기반 판단)을 구조적으로 막는다."
```

---

### Task 4: 조치 선택 (`selectActions.ts`)

**Files:**
- Create: `apps/dashboard/src/features/monitoring-remediate/lib/selectActions.ts`
- Test: `apps/dashboard/tests/unit/selectActions.test.ts`

**Interfaces:**
- Consumes: `POLICIES`, `OpenEventView`, `LiveFacts`, `RemediationAction` (Task 3), `evaluateGuards`, `AttemptSummary` (Task 2)
- Produces:
  - `type PlannedAction = { event: OpenEventView; policyId: string; action: RemediationAction }`
  - `type PlannedSkip = { event: OpenEventView; policyId: string; reason: string }`
  - `type SelectResult = { actions: PlannedAction[]; skips: PlannedSkip[] }`
  - `selectActions(events: OpenEventView[], historyByDedup: Map<string, AttemptSummary[]>, facts: LiveFacts, now: Date): SelectResult`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/tests/unit/selectActions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectActions } from "@/features/monitoring-remediate/lib/selectActions";
import { RESTART_EXCLUDED, type OpenEventView, type LiveFacts } from "@/features/monitoring-remediate/config/policies";
import { type AttemptSummary } from "@/features/monitoring-remediate/lib/guards";

const NOW = new Date("2026-07-28T12:00:00Z");
const facts: LiveFacts = {
  hostAvailableMemBytes: 13 * 1024 ** 3,
  containerExcluded: (n) => RESTART_EXCLUDED.some((x) => n.includes(x)),
};

function ev(over: Partial<OpenEventView>): OpenEventView {
  return {
    id: "e1",
    dedupKey: "k1",
    severity: "critical",
    source: "host",
    title: "t",
    detail: null,
    occurredAt: new Date("2026-07-28T09:00:00Z"), // 180분 전
    hostId: "h1",
    ...over,
  };
}

const redisDetail = JSON.stringify({
  usedPct: 78,
  evictionPolicy: "noeviction",
  maxMemBytes: 1073741824,
  target: "ais-prod",
});

describe("selectActions", () => {
  it("조건을 만족하면 조치를 계획한다", () => {
    const r = selectActions([ev({ detail: redisDetail })], new Map(), facts, NOW);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ policyId: "redis-maxmemory" });
  });

  it("지속 시간 미달이면 skip 으로 기록한다 (조용히 버리지 않는다)", () => {
    const r = selectActions(
      [ev({ detail: redisDetail, occurredAt: new Date("2026-07-28T11:50:00Z") })],
      new Map(),
      facts,
      NOW,
    );
    expect(r.actions).toHaveLength(0);
    expect(r.skips).toHaveLength(1);
    expect(r.skips[0].reason).toContain("지속");
  });

  it("정책이 없는 이벤트는 아무 결과도 만들지 않는다", () => {
    const r = selectActions([ev({ detail: null, source: "ssl" })], new Map(), facts, NOW);
    expect(r.actions).toHaveLength(0);
    // 정책의 사전 조건 불충족은 skip 으로 남는다 (감사 목적)
    expect(r.skips.length).toBeGreaterThan(0);
  });

  it("이력이 시도 상한에 도달했으면 조치하지 않는다", () => {
    const history = new Map<string, AttemptSummary[]>([
      [
        "k1",
        [
          { outcome: "executed", attemptedAt: new Date("2026-07-20T00:00:00Z") },
          { outcome: "executed", attemptedAt: new Date("2026-07-21T00:00:00Z") },
        ],
      ],
    ]);
    const r = selectActions([ev({ detail: redisDetail })], history, facts, NOW);
    expect(r.actions).toHaveLength(0);
    expect(r.skips[0].reason).toContain("시도");
  });

  it("한 이벤트에 대해 조치는 최대 하나만 계획한다", () => {
    const r = selectActions([ev({ detail: redisDetail })], new Map(), facts, NOW);
    expect(r.actions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/unit/selectActions.test.ts`
Expected: FAIL — import 해결 실패

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/monitoring-remediate/lib/selectActions.ts`:

```ts
// open 이벤트 → 실행할 조치 목록 (이슈 #352). 순수 함수.
//
// skip 을 조용히 버리지 않고 반환한다 — 왜 조치하지 않았는지가 감사 기록에
// 남아야 나중에 "자동화가 왜 안 돌았나" 를 추적할 수 있다.
import { POLICIES, type LiveFacts, type OpenEventView, type RemediationAction } from "../config/policies";
import { evaluateGuards, type AttemptSummary } from "./guards";

export type PlannedAction = {
  event: OpenEventView;
  policyId: string;
  action: RemediationAction;
};

export type PlannedSkip = {
  event: OpenEventView;
  policyId: string;
  reason: string;
};

export type SelectResult = {
  actions: PlannedAction[];
  skips: PlannedSkip[];
};

export function selectActions(
  events: OpenEventView[],
  historyByDedup: Map<string, AttemptSummary[]>,
  facts: LiveFacts,
  now: Date,
): SelectResult {
  const actions: PlannedAction[] = [];
  const skips: PlannedSkip[] = [];

  for (const event of events) {
    for (const policy of POLICIES) {
      const built = policy.buildAction(event, facts);
      if ("skip" in built) {
        skips.push({ event, policyId: policy.id, reason: built.skip });
        continue;
      }

      const verdict = evaluateGuards({
        severity: event.severity,
        occurredAt: event.occurredAt,
        maxAttempts: policy.maxAttempts,
        cooldownMinutes: policy.cooldownMinutes,
        history: historyByDedup.get(event.dedupKey) ?? [],
        now,
      });
      if (!verdict.allowed) {
        skips.push({ event, policyId: policy.id, reason: verdict.reason });
        continue;
      }

      actions.push({ event, policyId: policy.id, action: built });
      // 한 이벤트에 여러 조치를 겹쳐 실행하지 않는다 — 첫 매칭 정책만.
      break;
    }
  }

  return { actions, skips };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/unit/selectActions.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/monitoring-remediate/lib/selectActions.ts apps/dashboard/tests/unit/selectActions.test.ts
git commit -m "feat: open 이벤트에서 실행할 조치 선택

정책 매칭 + 안전장치 판정을 결합한 순수 함수. skip 사유를 버리지 않고
반환해 감사 기록에 남긴다."
```

---

### Task 5: `executeContainerAction` 분리 (인증 계층 재구성)

**Files:**
- Create: `apps/dashboard/src/features/container-actions/api/executeContainerAction.ts`
- Modify: `apps/dashboard/src/features/container-actions/api/_runAction.ts`
- Test: `apps/dashboard/tests/container-actions.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `runDocker`, `insertAuditLog` (기존)
- Produces: `executeContainerAction(action: "restart"|"start"|"stop", input: { hostId: string; containerId: string; containerName: string }, actor: string): Promise<ActionResult>`

**배경:** `_runAction` 의 보안 경계 5종 중 1·2(`auth()` 세션, `ADMIN_EMAILS`)는 사람 세션을 전제한다. cron 에는 세션이 없어 그대로 호출하면 항상 `UNAUTHORIZED` 다. 경계 3·4·5(입력 검증, host 검증, 감사 로그)만 분리해 두 진입점이 공유한다. **경계를 우회하는 것이 아니라 재구성하는 것** — cron 은 `CRON_BEARER_TOKEN` 이 인증을 담당한다.

- [ ] **Step 1: 기존 파일 전체를 읽는다**

Run: `cat apps/dashboard/src/features/container-actions/api/_runAction.ts`

리팩터링 전에 현재 5종 경계의 순서와 에러 코드를 정확히 파악한다. 기존 동작을 바꾸지 않는 것이 이 태스크의 성공 기준이다.

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/dashboard/tests/container-actions.test.ts` 에 추가한다:

```ts
it("executeContainerAction: 세션 없이도 시스템 actor 로 실행된다", async () => {
  const { executeContainerAction } = await import(
    "@/features/container-actions/api/executeContainerAction"
  );
  const result = await executeContainerAction(
    "restart",
    { hostId: "00000000-0000-0000-0000-000000000000", containerId: "abc123def456", containerName: "x" },
    "system:auto-remediate",
  );
  // 세션 부재가 이유인 UNAUTHORIZED 는 나오지 않아야 한다.
  // (host 가 없으므로 HOST_NOT_FOUND 가 기대값)
  expect(result).toMatchObject({ ok: false, code: "HOST_NOT_FOUND" });
});

it("executeContainerAction: containerId 형식 검증은 유지된다", async () => {
  const { executeContainerAction } = await import(
    "@/features/container-actions/api/executeContainerAction"
  );
  const result = await executeContainerAction(
    "restart",
    { hostId: "00000000-0000-0000-0000-000000000000", containerId: "../../etc", containerName: "x" },
    "system:auto-remediate",
  );
  expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/container-actions.test.ts`
Expected: FAIL — `executeContainerAction` 모듈 없음

- [ ] **Step 4: 실행 계층 분리**

`_runAction.ts` 에서 Zod 검증 이후의 로직(경계 3·4·5 + docker 실행)을 `executeContainerAction.ts` 로 옮긴다. `actor` 를 인자로 받아 `insertAuditLog` 의 `userEmail` 에 전달한다 — 이 필드는 `string` 이므로 타입 확장이 필요 없다.

```ts
// 컨테이너 액션 실행 계층 (이슈 #352).
//
// _runAction 에서 인증·인가(경계 1·2)를 제외한 나머지를 분리했다. 두 진입점이
// 공유한다:
//   - Server Action  : auth() + isAdmin() 검사 후 호출 (사람)
//   - auto-remediate : CRON_BEARER_TOKEN 으로 인증된 cron 이 호출 (시스템)
// 무인증 실행 경로는 없다 — 신뢰 주체가 다를 뿐이다.
import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { runDocker } from "@/shared/lib/docker";
import { logger } from "@/shared/lib/log";
import { insertAuditLog } from "./insertAuditLog";

const ActionInput = z.object({
  hostId: z.string().uuid(),
  containerId: z.string().regex(/^[a-f0-9]{12,64}$/),
  containerName: z.string().min(1).max(200),
});

export type ExecuteResult =
  | { ok: true }
  | { ok: false; code: "INVALID_INPUT" | "HOST_NOT_FOUND" | "DOCKER_ERROR"; message?: string };

export async function executeContainerAction(
  action: "restart" | "start" | "stop",
  rawInput: unknown,
  actor: string,
): Promise<ExecuteResult> {
  const parsed = ActionInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  const [host] = await db
    .select({ dockerContext: hosts.dockerContext })
    .from(hosts)
    .where(eq(hosts.id, input.hostId))
    .limit(1);
  if (host == null) return { ok: false, code: "HOST_NOT_FOUND" };

  const startedAt = Date.now();
  try {
    await runDocker(host.dockerContext, [action, input.containerId]);
    await insertAuditLog({
      hostId: input.hostId,
      containerId: input.containerId,
      containerName: input.containerName,
      action,
      userEmail: actor,
      status: "success",
      durationMs: Date.now() - startedAt,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "unknown";
    logger.error({ err, action, actor }, "container action failed");
    await insertAuditLog({
      hostId: input.hostId,
      containerId: input.containerId,
      containerName: input.containerName,
      action,
      userEmail: actor,
      status: "failed",
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });
    return { ok: false, code: "DOCKER_ERROR", message };
  }
}
```

- [ ] **Step 5: `_runAction` 을 위임 형태로 수정**

`_runAction.ts` 는 경계 1·2 를 유지한 뒤 `executeContainerAction` 을 호출하고, `revalidatePath` 는 성공 경로에서만 호출한다. 기존 에러 코드(`UNAUTHORIZED`/`FORBIDDEN`)와 반환 타입은 그대로 둔다.

- [ ] **Step 6: 전체 테스트로 회귀 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/container-actions.test.ts`
Expected: 기존 테스트 전부 PASS + 신규 2건 PASS

- [ ] **Step 7: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 에러 0

- [ ] **Step 8: 커밋**

```bash
git add apps/dashboard/src/features/container-actions/ apps/dashboard/tests/container-actions.test.ts
git commit -m "refactor: 컨테이너 액션의 인증 계층과 실행 계층 분리

_runAction 의 보안 경계 1·2(세션, ADMIN_EMAILS)는 사람 세션을 전제해
cron 에서 호출할 수 없었다. 경계 3·4·5(입력 검증, host 검증, 감사 로그)를
executeContainerAction 으로 분리해 두 진입점이 공유한다. 경계 우회가
아니라 재구성 — 무인증 실행 경로는 생기지 않는다."
```

---

### Task 6: 시도 기록 + 원자적 실행권 획득

**Files:**
- Create: `apps/dashboard/src/features/monitoring-remediate/api/attempts.ts`
- Test: `apps/dashboard/tests/remediation-attempts.test.ts`

**Interfaces:**
- Consumes: `remediationAttempts` (Task 1)
- Produces:
  - `claimAttempt(input: { eventId: string; dedupKey: string; policyId: string; action: string; dryRun: boolean; detail: string }): Promise<string | null>` — 실행권 획득 시 attempt id, 실패 시 null
  - `settleAttempt(id: string, outcome: "executed" | "failed", reason?: string): Promise<void>`
  - `recordSkip(input: { eventId: string; dedupKey: string; policyId: string; reason: string }): Promise<void>`
  - `loadHistory(dedupKeys: string[], since: Date): Promise<Map<string, AttemptSummary[]>>`
  - `reapStaleInFlight(olderThan: Date): Promise<number>`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/tests/remediation-attempts.test.ts`:

```ts
// 원자적 실행권 획득 통합 테스트 (TEST_DATABASE_URL 필요).
import { describe, it, expect, beforeEach } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { remediationAttempts } from "@/shared/lib/db/schema";
import {
  claimAttempt,
  settleAttempt,
  loadHistory,
  reapStaleInFlight,
  recordSkip,
} from "@/features/monitoring-remediate/api/attempts";

const PREFIX = `rem-test-${Date.now()}-`;
const KEY = `${PREFIX}host:x:redis`;

const baseClaim = {
  eventId: null as unknown as string,
  dedupKey: KEY,
  policyId: "redis-maxmemory",
  action: "raise-redis-maxmemory",
  dryRun: true,
  detail: "{}",
};

describe("remediation attempts", () => {
  beforeEach(async () => {
    await db.delete(remediationAttempts).where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
  });

  it("claimAttempt: 실행권을 얻으면 id 반환", async () => {
    const id = await claimAttempt(baseClaim);
    expect(id).not.toBeNull();
  });

  // cron 주기보다 조치가 길면 두 사이클이 같은 대상을 집는다. 재시작이
  // 겹치면 복구 중 서비스를 다시 죽이므로 DB 가 중재해야 한다.
  it("동시 claim 5건 중 하나만 성공 (부분 unique index 방어)", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimAttempt(baseClaim)),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("settleAttempt 후에는 다시 claim 할 수 있다", async () => {
    const first = await claimAttempt(baseClaim);
    await settleAttempt(first!, "executed");
    const second = await claimAttempt(baseClaim);
    expect(second).not.toBeNull();
  });

  it("loadHistory: dedupKey 별로 이력을 모은다", async () => {
    const id = await claimAttempt(baseClaim);
    await settleAttempt(id!, "executed");
    const map = await loadHistory([KEY], new Date(Date.now() - 60_000));
    expect(map.get(KEY)).toHaveLength(1);
    expect(map.get(KEY)![0].outcome).toBe("executed");
  });

  // 프로세스가 조치 도중 죽으면 in_flight 가 남아 대상이 영구히 잠긴다.
  it("reapStaleInFlight: 오래된 in_flight 를 failed 로 정리", async () => {
    await claimAttempt(baseClaim);
    const reaped = await reapStaleInFlight(new Date(Date.now() + 60_000));
    expect(reaped).toBeGreaterThanOrEqual(1);
    const again = await claimAttempt(baseClaim);
    expect(again).not.toBeNull();
  });

  it("recordSkip: skip 도 기록에 남는다", async () => {
    await recordSkip({
      eventId: null as unknown as string,
      dedupKey: KEY,
      policyId: "redis-maxmemory",
      reason: "지속 시간 부족",
    });
    const rows = await db
      .select()
      .from(remediationAttempts)
      .where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("skipped");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/remediation-attempts.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/monitoring-remediate/api/attempts.ts`:

```ts
// 자동 복구 시도 기록 + 원자적 실행권 획득 (이슈 #352).
//
// claim 은 recordEvent 의 INSERT-first 패턴을 미러한다. SELECT 로 "실행
// 중인가" 확인 후 INSERT 하면 두 사이클이 같은 틈에 통과한다 — INSERT 를
// 먼저 시도해 DB(remediation_in_flight_uq)가 중재하게 한다.
import "server-only";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { remediationAttempts } from "@/shared/lib/db/schema";
import { type AttemptSummary } from "../lib/guards";

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err == null) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((err as { cause?: unknown }).cause);
}

export type ClaimInput = {
  eventId: string;
  dedupKey: string;
  policyId: string;
  action: string;
  dryRun: boolean;
  detail: string;
};

/** 실행권 획득. 다른 사이클이 이미 실행 중이면 null. */
export async function claimAttempt(input: ClaimInput): Promise<string | null> {
  try {
    const [row] = await db
      .insert(remediationAttempts)
      .values({
        eventId: input.eventId ?? null,
        dedupKey: input.dedupKey,
        policyId: input.policyId,
        action: input.action,
        dryRun: input.dryRun,
        outcome: "in_flight",
        detail: input.detail,
      })
      .returning({ id: remediationAttempts.id });
    return row.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function settleAttempt(
  id: string,
  outcome: "executed" | "failed",
  reason?: string,
): Promise<void> {
  await db
    .update(remediationAttempts)
    .set({ outcome, reason: reason ?? null, settledAt: new Date() })
    .where(eq(remediationAttempts.id, id));
}

export async function recordSkip(input: {
  eventId: string;
  dedupKey: string;
  policyId: string;
  reason: string;
}): Promise<void> {
  await db.insert(remediationAttempts).values({
    eventId: input.eventId ?? null,
    dedupKey: input.dedupKey,
    policyId: input.policyId,
    action: "-",
    dryRun: true,
    outcome: "skipped",
    reason: input.reason,
    settledAt: new Date(),
  });
}

export async function loadHistory(
  dedupKeys: string[],
  since: Date,
): Promise<Map<string, AttemptSummary[]>> {
  if (dedupKeys.length === 0) return new Map();
  const rows = await db
    .select({
      dedupKey: remediationAttempts.dedupKey,
      outcome: remediationAttempts.outcome,
      attemptedAt: remediationAttempts.attemptedAt,
    })
    .from(remediationAttempts)
    .where(
      and(
        inArray(remediationAttempts.dedupKey, dedupKeys),
        gte(remediationAttempts.attemptedAt, since),
      ),
    );

  const map = new Map<string, AttemptSummary[]>();
  for (const r of rows) {
    const list = map.get(r.dedupKey) ?? [];
    list.push({ outcome: r.outcome, attemptedAt: r.attemptedAt });
    map.set(r.dedupKey, list);
  }
  return map;
}

/**
 * 고아 in_flight 정리. 프로세스가 조치 도중 죽으면 row 가 남아 해당 대상이
 * 영구히 잠긴다. 사이클 시작 시 호출한다.
 */
export async function reapStaleInFlight(olderThan: Date): Promise<number> {
  const rows = await db
    .update(remediationAttempts)
    .set({
      outcome: "failed",
      reason: "in-flight 고아 정리 (프로세스 중단 추정)",
      settledAt: new Date(),
    })
    .where(
      and(
        eq(remediationAttempts.outcome, "in_flight"),
        lt(remediationAttempts.attemptedAt, olderThan),
      ),
    )
    .returning({ id: remediationAttempts.id });
  return rows.length;
}
```

`isNull`, `sql` 이 쓰이지 않으면 import 에서 제거한다.

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run tests/remediation-attempts.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/monitoring-remediate/api/attempts.ts apps/dashboard/tests/remediation-attempts.test.ts
git commit -m "feat: 자동 복구 시도 기록 + 원자적 실행권 획득

recordEvent 의 INSERT-first 패턴을 미러해 동시 사이클이 같은 대상에
조치를 중복 실행하는 것을 DB 가 중재한다. 프로세스 중단으로 남은 고아
in_flight 정리도 포함."
```

---

### Task 7: 실행 디스패치 + 사이클 오케스트레이션

**Files:**
- Create: `apps/dashboard/src/features/monitoring-remediate/api/executeAction.ts`
- Create: `apps/dashboard/src/features/monitoring-remediate/api/runCycle.ts`
- Create: `apps/dashboard/src/features/monitoring-remediate/index.ts`
- Modify: `apps/dashboard/src/shared/config/env.ts`

**Interfaces:**
- Consumes: Task 3~6 전부, `executeContainerAction` (Task 5), `runDocker`
- Produces:
  - `executeAction(action: RemediationAction, hostContext: string): Promise<{ ok: boolean; message?: string }>`
  - `runRemediationCycle(now: Date): Promise<{ planned: number; executed: number; skipped: number; failed: number }>`
  - env: `AUTO_REMEDIATE_ENABLED` (boolean, 기본 false)

- [ ] **Step 1: env 플래그 추가**

`shared/config/env.ts` 의 Zod 스키마에 추가한다. **기본값은 dry-run** 이다 — 설정을 빠뜨렸을 때 조치가 실행되는 쪽으로 기울면 안 된다.

```ts
AUTO_REMEDIATE_ENABLED: z
  .string()
  .optional()
  .transform((v) => v === "true"),
```

`.env.example` 에도 주석과 함께 추가한다:

```
# 자동 복구 실행 스위치. 미설정/false 면 dry-run (계획만 기록, 조치 안 함).
AUTO_REMEDIATE_ENABLED=false
```

- [ ] **Step 2: 실행 디스패치 구현**

Create `apps/dashboard/src/features/monitoring-remediate/api/executeAction.ts`:

```ts
// 조치 실행 디스패치 (이슈 #352).
// 모든 조치는 기존 runDocker 를 경유한다 — 새 권한 경로를 만들지 않는다.
import "server-only";
import { runDocker } from "@/shared/lib/docker";
import { executeContainerAction } from "@/features/container-actions/api/executeContainerAction";
import { type RemediationAction } from "../config/policies";

/** 감사 로그에서 사람 조치와 구분하기 위한 actor. */
export const REMEDIATE_ACTOR = "system:auto-remediate";

export async function executeAction(
  action: RemediationAction,
  hostContext: string,
): Promise<{ ok: boolean; message?: string }> {
  switch (action.kind) {
    case "restart-container": {
      const r = await executeContainerAction(
        "restart",
        {
          hostId: action.hostId,
          containerId: action.containerId,
          containerName: action.containerName,
        },
        REMEDIATE_ACTOR,
      );
      return r.ok ? { ok: true } : { ok: false, message: r.code };
    }
    case "prune-images": {
      // dangling 한정 — volume 과 named image 는 건드리지 않는다.
      await runDocker(hostContext, ["image", "prune", "-f"]);
      return { ok: true };
    }
    case "raise-redis-maxmemory": {
      await runDocker(hostContext, [
        "exec",
        action.target,
        "redis-cli",
        "CONFIG",
        "SET",
        "maxmemory",
        String(action.nextBytes),
      ]);
      return { ok: true };
    }
  }
}
```

- [ ] **Step 3: 사이클 오케스트레이션 구현**

Create `apps/dashboard/src/features/monitoring-remediate/api/runCycle.ts`:

```ts
// 자동 복구 사이클 (이슈 #352).
//
// 순서: 고아 정리 → open 이벤트 조회 → 실측 수집 → 조치 선택 → claim →
// 실행 → settle. 실행 여부는 AUTO_REMEDIATE_ENABLED 가 결정하고, 기본은
// dry-run 이다.
import "server-only";
import { and, isNull } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts, monitoringEvents } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";
import { recordEvent } from "@/entities/monitoring/api/events";
import { selectActions } from "../lib/selectActions";
import { RESTART_EXCLUDED, type LiveFacts, type OpenEventView } from "../config/policies";
import { claimAttempt, loadHistory, recordSkip, reapStaleInFlight, settleAttempt } from "./attempts";
import { executeAction } from "./executeAction";

/** 조치가 이보다 오래 in-flight 면 프로세스가 죽은 것으로 본다. */
const STALE_IN_FLIGHT_MINUTES = 30;
/** 이력 조회 창 — 쿨다운 최대값(24h)보다 넉넉하게. */
const HISTORY_WINDOW_HOURS = 72;

export type CycleSummary = {
  planned: number;
  executed: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

export async function runRemediationCycle(now: Date): Promise<CycleSummary> {
  const dryRun = !env.AUTO_REMEDIATE_ENABLED;

  await reapStaleInFlight(new Date(now.getTime() - STALE_IN_FLIGHT_MINUTES * 60_000));

  const openRows = await db
    .select()
    .from(monitoringEvents)
    .where(isNull(monitoringEvents.resolvedAt));

  const events: OpenEventView[] = openRows.map((r) => ({
    id: r.id,
    dedupKey: r.dedupKey,
    severity: r.severity,
    source: r.source,
    title: r.title,
    detail: r.detail,
    occurredAt: r.occurredAt,
    hostId: r.hostId,
  }));

  const history = await loadHistory(
    events.map((e) => e.dedupKey),
    new Date(now.getTime() - HISTORY_WINDOW_HOURS * 3600_000),
  );

  const facts: LiveFacts = {
    hostAvailableMemBytes: await readHostAvailableMemBytes(),
    containerExcluded: (name) => RESTART_EXCLUDED.some((x) => name.includes(x)),
  };

  const { actions, skips } = selectActions(events, history, facts, now);

  for (const s of skips) {
    await recordSkip({
      eventId: s.event.id,
      dedupKey: s.event.dedupKey,
      policyId: s.policyId,
      reason: s.reason,
    });
  }

  let executed = 0;
  let failed = 0;
  for (const plan of actions) {
    const attemptId = await claimAttempt({
      eventId: plan.event.id,
      dedupKey: plan.event.dedupKey,
      policyId: plan.policyId,
      action: plan.action.kind,
      dryRun,
      detail: JSON.stringify(plan.action),
    });
    // null = 다른 사이클이 실행 중. 이번엔 건너뛴다.
    if (attemptId == null) continue;

    if (dryRun) {
      await settleAttempt(attemptId, "executed", "dry-run — 실제 조치 없음");
      executed += 1;
      continue;
    }

    const hostContext = await readHostContext(plan.action.hostId);
    if (hostContext == null) {
      await settleAttempt(attemptId, "failed", "host context 조회 실패");
      failed += 1;
      continue;
    }

    try {
      const r = await executeAction(plan.action, hostContext);
      if (r.ok) {
        await settleAttempt(attemptId, "executed");
        executed += 1;
        await notifyIfPermanenceNeeded(plan.action);
      } else {
        await settleAttempt(attemptId, "failed", r.message);
        failed += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 500) : "unknown";
      logger.error({ err, action: plan.action }, "auto-remediate action failed");
      await settleAttempt(attemptId, "failed", msg);
      failed += 1;
    }
  }

  return { planned: actions.length, executed, skipped: skips.length, failed, dryRun };
}

/**
 * Redis CONFIG SET 은 재시작 시 원복된다. compose 파일은 호스트에 있어
 * 컨테이너에서 고칠 수 없으므로, 사람이 마무리하도록 이벤트를 남긴다 —
 * 자동 조치가 근본 원인을 조용히 덮지 않게 하는 장치다.
 */
async function notifyIfPermanenceNeeded(action: { kind: string; target?: string }): Promise<void> {
  if (action.kind !== "raise-redis-maxmemory") return;
  await recordEvent({
    source: "host",
    severity: "warning",
    title: `Redis ${action.target} maxmemory 상향의 영구화 필요 (compose 수정)`,
    detail: JSON.stringify({ action }),
    dedupKey: `remediate:permanence:redis:${action.target}`,
  });
}

async function readHostContext(hostId: string): Promise<string | null> {
  const [row] = await db
    .select({ ctx: hosts.dockerContext })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  return row?.ctx ?? null;
}

/**
 * 호스트 여유 메모리 실측.
 *
 * Phase 1 은 null 을 반환한다 — 현재 metric_samples 는 mem.used_pct(비율)만
 * 수집하고 총 메모리 바이트를 싣지 않아, 여유 바이트를 정확히 계산할 수 없다.
 * 비율에서 역산하면 추정값이 되는데, 추정으로 메모리 상한을 올리면 호스트가
 * OOM 에 빠진다. null 이면 redis-maxmemory 정책이 "여유 불명" 으로 skip 하므로
 * 안전한 기본값이다.
 *
 * Phase 2 에서 에이전트가 mem.total_bytes 를 함께 싣도록 확장한 뒤 여기서
 * (total - used) 를 계산한다.
 */
async function readHostAvailableMemBytes(): Promise<number | null> {
  return null;
}
```

`and`, `isNull` 이 실제로 쓰이는지 확인하고 안 쓰이면 import 에서 제거한다
(`isNull` 은 open 이벤트 조회에 쓰이므로 남는다).

> **Phase 1 의 의도된 귀결:** 위 이유로 redis-maxmemory 조치는 Phase 1 에서
> 항상 skip 된다. dry-run 로그에 "호스트 여유 메모리 부족/불명" 이 남는 것이
> 정상 동작이며, 이것이 Phase 2 에서 메트릭을 확장해야 한다는 신호가 된다.

- [ ] **Step 4: barrel 생성**

Create `apps/dashboard/src/features/monitoring-remediate/index.ts`:

```ts
import "server-only";
export { runRemediationCycle, type CycleSummary } from "./api/runCycle";
```

Gotcha #7 에 따라 server-only 진입점으로 둔다. client 컴포넌트가 이 barrel 을 import 하지 않는다.

- [ ] **Step 5: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 에러 0

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/features/monitoring-remediate/ apps/dashboard/src/shared/config/env.ts apps/dashboard/.env.example
git commit -m "feat: 자동 복구 실행 디스패치 + 사이클 오케스트레이션

AUTO_REMEDIATE_ENABLED 미설정 시 dry-run 이 기본값 — 설정을 빠뜨렸을 때
조치가 실행되는 쪽으로 기울지 않게 한다. Redis 상향은 재시작 시 원복되
므로 영구화 필요 이벤트를 함께 발행한다."
```

---

### Task 8: cron route + 스케줄 등록

**Files:**
- Create: `apps/dashboard/src/app/api/cron/auto-remediate/route.ts`
- Modify: `apps/cron/scheduler.js`
- Test: `apps/dashboard/tests/unit/autoRemediateRoute.test.ts`

**Interfaces:**
- Consumes: `runRemediationCycle` (Task 7)
- Produces: `POST /api/cron/auto-remediate`

- [ ] **Step 1: route 구현**

기존 `monitoring-notify/route.ts` 의 `createCronHandler` 패턴을 따른다.

```ts
// 5분마다 — 관제 자동 복구 사이클 (이슈 #352).
// 판정·실행 로직은 features/monitoring-remediate 에 있다.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { runRemediationCycle } from "@/features/monitoring-remediate";

export const dynamic = "force-dynamic";

const TARGETS = [{ id: "cycle" }] as const;

export const POST = createCronHandler({
  name: "auto-remediate",
  targetSelect: async () => [...TARGETS],
  getId: (t) => t.id,
  perTarget: () => runRemediationCycle(new Date()),
});
```

- [ ] **Step 2: cron 스케줄 등록**

`apps/cron/scheduler.js` 의 기존 `cron.schedule(...)` 블록들과 같은 형태로 추가한다. 5분 주기(`*/5 * * * *`), 호출 대상은 `/api/cron/auto-remediate`. 기존 블록의 인증 헤더·에러 처리 방식을 그대로 복사한다.

- [ ] **Step 3: 빌드 검증 (Gotcha #7)**

Run: `cd apps/dashboard && pnpm build`
Expected: 성공. 실패 시 `Module not found: Can't resolve 'tls'` 류라면 barrel 의 server/client seam 문제다 — `index.ts` 가 client 트리로 끌려가지 않는지 확인한다.

- [ ] **Step 4: 전체 테스트**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/app/api/cron/auto-remediate/ apps/cron/scheduler.js
git commit -m "feat: 자동 복구 cron 잡 등록 (5분 주기)

Phase 1 은 dry-run 으로 운영해 판정을 무해하게 검증한다."
```

---

### Task 9: 관측 — dry-run 결과를 볼 수 있게

**Files:**
- Modify: `apps/dashboard/src/app/(dashboard)/monitoring/page.tsx`
- Create: `apps/dashboard/src/widgets/monitoring/ui/RemediationBoard.tsx`
- Create: `apps/dashboard/src/entities/monitoring/api/remediations.ts`
- Modify: `apps/dashboard/src/entities/monitoring/server.ts`
- Modify: `apps/dashboard/src/widgets/monitoring/index.ts`

**Interfaces:**
- Consumes: `remediationAttempts` (Task 1)
- Produces: `listRecentRemediations(limit: number): Promise<RemediationRow[]>`, `<RemediationBoard rows={...} now={...} />`

**배경:** Phase 1 의 목적은 dry-run 로그를 사람이 검토하는 것이다. DB 를 직접 조회해야만 볼 수 있으면 검토가 이뤄지지 않는다.

- [ ] **Step 1: 조회 함수 추가**

`entities/monitoring/api/remediations.ts` 를 만들고 `server.ts` barrel 에 re-export 한다. 최근 시도를 `attempted_at DESC` 로 반환한다. 기존 `listRecentEvents` 의 구조를 그대로 따른다.

- [ ] **Step 2: 보드 컴포넌트**

`EventsTimeline.tsx` 의 스타일 규약을 따른다. 표시 항목: 시각(locale-free `HH:MM:SS` — Gotcha #3), 정책 id, 조치, outcome 배지, dry-run 배지, reason. `outcome` 별 색은 `SeverityBadge` 의 토큰을 재사용한다.

- [ ] **Step 3: 페이지에 배치**

`monitoring/page.tsx` 의 드릴다운 영역에 추가한다. `listRecentRemediations` 를 기존 `Promise.all` 블록에 넣어 워터폴을 만들지 않는다.

- [ ] **Step 4: 빌드 + 테스트**

Run: `cd apps/dashboard && pnpm build && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/
git commit -m "feat: 자동 복구 시도 보드 추가

Phase 1 dry-run 로그를 관제 화면에서 검토할 수 있게 한다. DB 를 직접
조회해야만 보이면 검토가 이뤄지지 않는다."
```

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | 구현 태스크 |
|---|---|
| 아키텍처 (features 구조) | Task 3·4·6·7 |
| 트리거 정책 (지속 시간) | Task 2 (`MIN_OPEN_MINUTES`) |
| 조치 카탈로그 3종 | Task 3 (정책) + Task 7 (실행) |
| 안전장치 1·2·3 (시도·효과·쿨다운) | Task 2 |
| 안전장치 4 (kill switch) | Task 7 (env) |
| 안전장치 5 (전량 감사) | Task 1·6 |
| 안전장치 6 (관측된 사실만) | Task 3 (`LiveFacts`, skip 경로) |
| 안전장치 7 (원자적 claim) | Task 1 (index) + Task 6 (claim) |
| 고아 in-flight 정리 | Task 6 (`reapStaleInFlight`) |
| cron 인증 (계층 분리) | Task 5 |
| Redis 영구화 한계 | Task 7 (`notifyIfPermanenceNeeded`) |
| 데이터 모델 | Task 1 |
| dry-run 롤아웃 | Task 7 (기본값) + Task 9 (검토 수단) |
| 테스트 전략 | Task 2·3·4 (unit), 5·6 (통합) |

**미포함 사항 (의도적)**

- 스펙 §안전장치 2 의 "효과 검증"은 쿨다운 + 시도 횟수 상한으로 실질 달성된다. 별도 "다음 사이클에 해소 확인" 로직은 Phase 2 에서 dry-run 데이터를 본 뒤 필요성이 확인되면 추가한다. 지금 넣으면 근거 없는 복잡도다.
- 텔레그램 알림은 기존 `monitoring-notify` 가 critical 이벤트를 이미 발송하므로, Task 7 의 "영구화 필요" 이벤트가 그 경로를 탄다. 별도 알림 경로를 만들지 않는다.

**타입 일관성 확인**

- `AttemptSummary` — Task 2 정의, Task 4·6 소비. 필드 `outcome: string`, `attemptedAt: Date` 일치.
- `OpenEventView` / `LiveFacts` / `RemediationAction` — Task 3 정의, Task 4·7 소비.
- `executeContainerAction(action, input, actor)` — Task 5 정의, Task 7 호출. 인자 3개 일치.
- `claimAttempt` 반환 `string | null` — Task 6 정의, Task 7 에서 null 체크.

**열린 값 (Phase 1 관찰 후 확정)**

`maxAttempts`(1~2), `cooldownMinutes`(30분~24시간)의 현재 값은 초기 추정이다. dry-run 로그로 실제 발생 빈도를 본 뒤 조정한다. 스펙 §열린 질문과 일치한다.
