# Testing Patterns

**Analysis Date:** 2026-05-11

## Test Framework

**Runner:**
- **Vitest** ^4.1.5 (with `@vitest/ui` ^4.1.5)
- Config: `vitest.config.ts`

**Environment / Setup:**
- `environment: "node"` — Node runner (DOM-touching tests do not exist in v0.1; `jsdom` is installed but unused)
- `include: ["tests/**/*.test.ts"]` — flat `tests/` directory at the repo root, NOT co-located with sources
- `setupFiles: ["./tests/setup.ts"]` — global preamble for every test file
- `env: { TZ: "Asia/Seoul" }` — KST forced at the runner level so cron/timezone regression assertions are deterministic
- Module alias: `@` → `src/` (mirror of `tsconfig.json`)

**Assertion Library:** Built-in `expect` (`vitest`).

**Run Commands (`package.json` scripts):**
```bash
pnpm test                                          # vitest run (one-shot)
pnpm test:watch                                    # vitest watch
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
                                                   # required for integration tests
```

**Local test DB recipe (from `CLAUDE.md` Gotcha #2):**
```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```

If `TEST_DATABASE_URL` points at no live DB, the integration tests fail with `ECONNREFUSED`; pure-unit tests still pass.

## Safety Invariant — Prod DB Hard Block (CRITICAL)

**File:** `tests/setup.ts`

The setup file is the first thing the runner loads. It enforces a two-stage guard against running integration tests against production PostgreSQL:

```typescript
const PROD_HOST_PATTERNS = [
  /\b192\.168\.0\.5(?::|\/|$)/,  // home-server
  /\bgons\.krdn\.kr\b/i,
];

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;  // override .env
}

const dbUrl = process.env.DATABASE_URL ?? "";
for (const pattern of PROD_HOST_PATTERNS) {
  if (pattern.test(dbUrl)) {
    throw new Error("[tests/setup.ts] DATABASE_URL이 prod-like 호스트를 가리킵니다 ...");
  }
}

vi.mock("server-only", () => ({}));   // neutralise server-only guard inside tests
```

**Why this exists:** Integration tests perform direct `INSERT` / `DELETE` against the live Drizzle client. A prior incident leaked 200+ test-* / act-* / cycle-* rows into the production `users` table when a developer's `DATABASE_URL` was still pointed at `192.168.0.5:5440`. The guard is permanent.

**Rules this implies:**
- Any commit that loosens the regex (`PROD_HOST_PATTERNS`) requires explicit justification.
- New prod hosts (additional home labs, staging mirrors) MUST be added to `PROD_HOST_PATTERNS` before tests can run against them.
- The `vi.mock("server-only", () => ({}))` line lets server-only modules import in the test environment without throwing — do not remove it.

## Test File Organization

**Location:** Flat `tests/` directory at the repo root. No `__tests__` folders, no co-located `*.test.ts` beside source files.

**Naming:** `<unit-under-test>.test.ts` — kebab-case. One concern per file.

**Structure:**
```
tests/
├── setup.ts                                  # global preamble (prod-DB guard, dotenv, server-only mock)
├── classify-important-thread.test.ts
├── cleanup-projects.test.ts
├── container-actions-admin.test.ts
├── container-actions.test.ts
├── container-list-group-by-project.test.ts
├── cron-tz.test.ts
├── deterministic-classifier.test.ts
├── docker-inspect-container.test.ts
├── docker-list-containers.test.ts
├── docker-mask-env.test.ts
├── docker-parse-container.test.ts
├── docker-run.test.ts
├── get-important-emails.test.ts
├── host-api.test.ts
├── important-actions.test.ts
├── important-classify-cycle.test.ts
├── known-compose-projects.test.ts
├── llm-classify-important.test.ts
├── project-api.test.ts
├── reclassify-recent.test.ts
├── safe-external-url.test.ts
├── unsubscribe-filter.test.ts
└── upsert-project-from-container.test.ts
```

Total: 23 test files, 1 setup.

## Test Taxonomy

The suite falls into three categories. Knowing which one a test belongs to tells you what infrastructure it needs.

### 1. Pure Unit (no DB, mocks where needed) — 15 files

Run with any `TEST_DATABASE_URL`; pass even without a DB host.

| File | What it asserts |
|------|------------------|
| `tests/safe-external-url.test.ts` | `safeExternalUrl` accepts http/https, rejects `javascript:`/`data:`/`file:`, returns null for null/garbage |
| `tests/deterministic-classifier.test.ts` | Pre-LLM keyword classifier — owner-as-sender→null, KR/EN deadline→`high`, KR/EN question→`med`, case-insensitive email compare |
| `tests/cron-tz.test.ts` | `TZ=Asia/Seoul` is forced; `Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul" })` converts UTC 23:00→KST 08:00, KST day boundary correctness |
| `tests/docker-mask-env.test.ts` | `maskEnv` table-driven via `it.each` — `API_KEY/TOKEN/PASSWORD/SECRET/DATABASE_URL` masked, `NODE_ENV/PORT/TZ/LANG` not; case-insensitive |
| `tests/docker-parse-container.test.ts` | `parseContainer` maps `docker container ls --format json` rows to `ContainerSummary`; compose labels, port mapping, `uptimeSeconds` heuristic, IPv6 dual-stack drop, enum throw on unknown state |
| `tests/docker-run.test.ts` | `runDocker` invokes the docker CLI with the right `--context` + args; default 10s timeout, `opts.timeoutMs` override; uses `util.promisify.custom` to model real Node `child_process` behaviour |
| `tests/docker-list-containers.test.ts` | `listContainers` issues `container ls --all --no-trunc --format {{json .}}`, parses NDJSON, skips malformed lines with warn |
| `tests/docker-inspect-container.test.ts` | `inspectContainer` returns `envMasked`, `mounts`, `imageDigest` (only when `sha256:`-prefixed); null labels safe; empty `[]` response throws |
| `tests/container-actions-admin.test.ts` | `isAdmin` exact match, multi-email split, trim, case-insensitive; null/undefined → false |
| `tests/cleanup-projects.test.ts` | `computeZombieIds` — pure set-arithmetic between live set, whitelist set, and DB rows |
| `tests/container-list-group-by-project.test.ts` | `groupByProject` — compose-label grouping + project join, `standalone` virtual group, hidden project hidden, pinned→alpha→standalone order, `isStale=true` for empty live containers |
| `tests/unsubscribe-filter.test.ts` | `isMailingList` — header signals (`List-Unsubscribe`, `List-ID`, `Precedence: bulk/list/junk`), `noreply` + body "unsubscribe", security/payment passes |
| `tests/known-compose-projects.test.ts` | Static membership of `KNOWN_COMPOSE_PROJECTS_BY_HOST` and `KNOWN_HOSTS` (now a pinned-hint, not a gate) |
| `tests/upsert-project-from-container.test.ts` | `upsertProjectFromContainer` auto-registers any (host, compose) pair via a fully mocked Drizzle chain; `displayName` defaults to compose key |
| `tests/llm-classify-important.test.ts` | `classifyImportantWithLlm` — Anthropic SDK mocked; valid JSON → parsed result, `category=none` → null, JSON parse failure → null, Zod violations → null, 5xx/429 → throw, empty content → null, all four categories pass schema |

### 2. DB Integration (real Postgres required) — 8 files

These require `TEST_DATABASE_URL` to resolve to a live Postgres (the prod-DB guard hard-blocks production targets).

| File | What it asserts |
|------|------------------|
| `tests/host-api.test.ts` | `getHosts` (active-only, alphabetic), `getHostByName` (match / null) — uses per-run sentinel prefix to isolate rows |
| `tests/project-api.test.ts` | `getProjects` (hidden excluded, pinned-first), `upsertProjectFromContainer` (auto-register, preserve existing `displayName`) — per-run host sentinel |
| `tests/container-actions.test.ts` | Server Action security boundary — admin success path writes audit `success`, non-admin returns `FORBIDDEN` with no audit, docker failure writes audit `failed`, invalid `containerId` rejected with `INVALID_INPUT`, unknown `hostId` → `HOST_NOT_FOUND`, missing session → `UNAUTHORIZED`. Mocks `auth`, `runDocker`, `next/cache` |
| `tests/classify-important-thread.test.ts` | Orchestrator — INSERT on classified, no-op on mailing-list signals, no-op on `none`, idempotent (same input twice → 1 INSERT, `skipped-already`), 5xx → `skipped-llm-error`. Mocks Anthropic |
| `tests/important-classify-cycle.test.ts` | `syncInbox` cycle — reply-needed + important classifiers chained in a single sweep; important LLM failure does not abort the cycle (`result.kind` still `ok-*`). Mocks Gmail history/messages + Anthropic |
| `tests/important-actions.test.ts` | `markAsRead` / `archiveThread` Server Actions — Gmail call + DB update, Gmail 5xx leaves DB untouched, foreign user's `threadId` → `not-found`, no session → `unauthorized`, Gmail 404 on archive still marks `archived_at` (cleanup) |
| `tests/get-important-emails.test.ts` | D6 reply-priority policy — active `reply_needed` hides important row; `repliedAt`/`dismissedAt` brings it back; `readAt`/`archivedAt` excludes; 7-day window; sort high-then-med then `classified_at` DESC; limit 10 |
| `tests/reclassify-recent.test.ts` | `reclassifyRecent` — user-not-found, 24h SQL window (old thread excluded), `force=true` deletes and reclassifies, `force=false` preserves and reports `skipped-already`. Mocks Anthropic |

### 3. LLM Real-Call — none currently

Every LLM-touching test mocks `@/shared/lib/llm/anthropic`. No real-call test exists in v0.1; `pnpm test` is fully offline-deterministic for the LLM layer.

**Forward guidance:** if real-call coverage is added later, gate it behind a `TEST_LLM_REAL=1` opt-in (skip-by-default) so the default `pnpm test` stays deterministic and network-free.

## Test Structure (AAA + Korean test names)

Korean `it("...")` titles describe behaviour from the user's perspective. Pattern:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("classifyImportantWithLlm", () => {
  beforeEach(() => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockReset();
  });

  it("정상 JSON → 파싱 성공", async () => {
    mockLlmJson({ category: "money", importance: "high", summary: "...", rationale: "..." });
    const result = await classifyImportantWithLlm(baseInput);
    expect(result?.category).toBe("money");
  });
});
```

Common shape:
- `describe` per public function / orchestrator
- `it` per behaviour, Korean title with the policy citation when applicable (`"CRITICAL #4 — 한국어 마감 키워드 → high"`, `"D6 — 활성 reply_needed 있는 스레드는 숨김"`)
- `beforeEach` resets mocks and prunes test rows; `beforeAll` seeds users/threads that all `it` in the file share
- `afterAll` cleans up host/project rows tied to the per-run prefix

## Mocking

**Framework:** Vitest's `vi` (`vi.mock`, `vi.fn`, `vi.spyOn`, `vi.importActual`).

**Standard recipe — module-level `vi.mock` at the top of the file:**

```typescript
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/shared/api/gmail/modify", () => ({ modifyThread: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/shared/lib/auth";
import { modifyThread } from "@/shared/api/gmail/modify";

beforeEach(() => {
  (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  (modifyThread as ReturnType<typeof vi.fn>).mockReset();
});
```

**Partial mock (preserve exports):**
```typescript
vi.mock("@/shared/lib/docker", async () => {
  const actual =
    await vi.importActual<typeof import("@/shared/lib/docker")>("@/shared/lib/docker");
  return { ...actual, runDocker: (...a: unknown[]) => mockRunDocker(...a) };
});
```

**Dynamic import after mocking** (necessary when the module-under-test reads mocked deps at import-time):
```typescript
let listContainers: typeof import("@/shared/lib/docker/listContainers").listContainers;
beforeEach(async () => {
  mockRunDocker.mockReset();
  ({ listContainers } = await import("@/shared/lib/docker/listContainers"));
});
```

**`promisify.custom` trick (`tests/docker-run.test.ts`):**
Node's `child_process.execFile` exposes `[util.promisify.custom]` so `promisify(execFile)` resolves to `{ stdout, stderr }`. A naive `vi.fn()` mock drops that symbol and `promisify` falls back to the callback's single value. The fix:

```typescript
vi.mock("node:child_process", () => {
  const execFile = Object.assign(
    (file, args, opts, cb) => cb(null, "ok\n", ""),
    {
      [promisify.custom]: (file, args, opts) =>
        Promise.resolve({ stdout: "ok\n", stderr: "" }),
    },
  );
  return { execFile };
});
```

**`vi.spyOn` for transient stubs:**
```typescript
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
// ... assertions ...
warnSpy.mockRestore();
```

**What to mock:** outbound side-effects — Anthropic SDK, Gmail HTTP modules, Docker CLI (`runDocker`), `next/cache` `revalidatePath`, `auth()` session, sometimes `db` (only in `upsert-project-from-container` for pure unit coverage).

**What NOT to mock in integration tests:** Drizzle / Postgres — DB integration tests exercise the real schema, foreign-key behaviour, and unique constraints. They run against the local Postgres pointed to by `TEST_DATABASE_URL`.

## Test Isolation Patterns

**Per-run sentinel prefix** (used in `host-api`, `project-api`, `reclassify-recent`, `container-actions`, `classify-important-thread`, `important-actions`, `important-classify-cycle`, `get-important-emails`):

```typescript
const PREFIX = `host-api-${Date.now()}-`;

beforeEach(async () => {
  await db.delete(hosts).where(like(hosts.name, `${PREFIX}%`));
});
```

Reason: Vitest parallelises across files. Several DB integration tests touch `hosts` / `users` / `email_threads`. A unique prefix per test file/run scopes every `DELETE` and every assertion filter to rows that file owns.

**Foreign-key-aware cleanup** (`container-actions.test.ts`):
- `audit_logs.host_id` has `ON DELETE NO ACTION` → delete children first, then the host

```typescript
const [prior] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.name, HOST_NAME)).limit(1);
if (prior) {
  await db.delete(auditLogs).where(eq(auditLogs.hostId, prior.id));
  await db.delete(hosts).where(eq(hosts.id, prior.id));
}
```

**Module-scoped reusable seed helpers** (`get-important-emails.test.ts`): `seedThread`, `seedImportant`, `seedReplyNeeded` keep per-test setup readable.

## Fixtures and Factories

- No global `fixtures/` directory. Each file declares the minimal seed it needs inline (typically a `baseInput` constant + `c(...)` / `p(...)` factory functions that spread overrides).
- Pattern:
  ```typescript
  function c(overrides: Partial<ContainerSummary>): ContainerSummary {
    return { id: "id", name: "name", state: "running", ...overrides };
  }
  ```

## Coverage

- No coverage threshold is enforced. `vitest` does not run with `--coverage` in `pnpm test`.
- Coverage can be invoked ad hoc via `pnpm test -- --coverage` (uses Vitest's default `v8` provider).

## Coverage by Area (file count)

| Area | Test files |
|------|-----------|
| Container actions (Server Actions, audit, security boundary) | 2 (`container-actions.test.ts`, `container-actions-admin.test.ts`) |
| Host API (entities/host) | 1 (`host-api.test.ts`) |
| Project API (entities/project, compose registration) | 3 (`project-api.test.ts`, `upsert-project-from-container.test.ts`, `known-compose-projects.test.ts`) |
| Docker CLI layer (shared/lib/docker) | 5 (`docker-run`, `docker-list-containers`, `docker-inspect-container`, `docker-parse-container`, `docker-mask-env`) |
| Container grouping (features/container-list) | 1 (`container-list-group-by-project.test.ts`) |
| Email classification (deterministic + LLM + mailing-list filter) | 3 (`deterministic-classifier`, `unsubscribe-filter`, `llm-classify-important`) |
| Email orchestration (cron sweep + important upsert + reclass) | 3 (`classify-important-thread`, `important-classify-cycle`, `reclassify-recent`) |
| Email actions (markAsRead / archive) | 1 (`important-actions.test.ts`) |
| Email retrieval / reply-priority policy | 1 (`get-important-emails.test.ts`) |
| Cron / timezone regression | 1 (`cron-tz.test.ts`) |
| Misc utilities | 2 (`safe-external-url.test.ts`, `cleanup-projects.test.ts`) |

## Common Patterns

**Async testing:**
```typescript
it("정상 분류 → DB INSERT", async () => {
  mockLlm({ category: "money", importance: "high", summary: "...", rationale: "..." });
  const outcome = await classifyImportantThread({ userId, threadId, input, signals });
  expect(outcome.kind).toBe("classified");
});
```

**Error testing:**
```typescript
mockLlmThrow(Object.assign(new Error("503"), { status: 503 }));
await expect(classifyImportantWithLlm(baseInput)).rejects.toThrow();
```

**Table-driven (`it.each`):**
```typescript
it.each([
  ["ANTHROPIC_API_KEY", true],
  ["DB_PASSWORD", true],
  ["NODE_ENV", false],
])("민감 키 %s → 마스킹 %s", (key, expected) => {
  expect(maskEnv(key)).toBe(expected);
});
```

**Capture-and-assert via mock:**
```typescript
expect(mockRunDocker).toHaveBeenCalledWith("home-server", ["restart", VALID_ID]);
```

## What Is Skipped or Deliberately Out of Scope

- **Real Anthropic API calls** — every LLM test mocks `@/shared/lib/llm/anthropic`. If reintroduced, gate behind `TEST_LLM_REAL=1` to keep default runs offline.
- **Real Gmail API calls** — `getValidAccessToken`, `listHistorySince`, `getMessage`, `modifyThread` are mocked at the module boundary.
- **Real Docker daemon** — `runDocker` is mocked everywhere except `docker-run.test.ts`, which itself mocks `node:child_process`.
- **DOM / component rendering** — `@testing-library/react` and `jsdom` are installed but unused in v0.1. UI behaviour is validated manually; visual regression / E2E is deferred.
- **Coverage thresholds** — not enforced.

---

*Testing analysis: 2026-05-11*
