<!-- refreshed: 2026-05-11 -->
# Architecture

**Analysis Date:** 2026-05-11

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router (RSC + Server Actions + Route Handlers)          │
│  `src/app/**`                                                            │
│    page.tsx / layout.tsx / servers/[hostName]/page.tsx                   │
│    api/cron/*  api/admin/*  api/auth/[...nextauth]  api/push  api/health │
└──────────────────────────────────────────────┬──────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  widgets — RSC composition cards (dashboard tiles, host shell)           │
│  `src/widgets/{email-digest,important-emails,server-overview,            │
│                host-dashboard}/`                                          │
└──────────────────────────────────────────────┬──────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  features — user-facing actions & flows (Server Actions, sync jobs)      │
│  `src/features/{auth,container-actions,container-list,                   │
│                 email-analysis,gmail-sync,host-catalog}/`                 │
└──────────────────────────────────────────────┬──────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  entities — domain models + repositories (read APIs, types, UI atoms)    │
│  `src/entities/{container,digest,email,host,project}/`                   │
└──────────────────────────────────────────────┬──────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  shared — infra (DB, auth, docker CLI, LLM proxy, env, UI primitives)    │
│  `src/shared/{api,config,lib,ui}/`                                        │
└──────────────┬──────────────────────────┬───────────────────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────┐   ┌────────────────────────────────────────┐
│ PostgreSQL 16 (Drizzle)  │   │ External adapters                       │
│ `drizzle/**` migrations  │   │  - Gmail REST (`shared/api/gmail/**`)   │
│ schema: `src/shared/lib/ │   │  - Anthropic SDK → Claude Code Proxy    │
│   db/schema.ts`          │   │    (`shared/lib/llm/anthropic.ts`)      │
│                          │   │  - `docker --context` CLI                │
│                          │   │    (`shared/lib/docker/runDocker.ts`)   │
│                          │   │  - web-push VAPID                        │
│                          │   │    (`shared/lib/push/**`)                │
└──────────────────────────┘   └────────────────────────────────────────┘
```

A separate `cron/` Node container (`cron/scheduler.js`) calls `POST /api/cron/*` with a Bearer token; it does not import any `src/` code.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App Router pages | Auth gate, RSC data assembly, Suspense boundaries | `src/app/page.tsx`, `src/app/servers/[hostName]/page.tsx` |
| Route handlers (cron) | Bearer-gated batch endpoints for poll + digest | `src/app/api/cron/poll-gmail/route.ts`, `src/app/api/cron/morning-digest/route.ts` |
| Route handler (auth) | NextAuth v5 GET/POST mount | `src/app/api/auth/[...nextauth]/route.ts` |
| Route handler (push) | Per-user subscription upsert/delete | `src/app/api/push/subscribe/route.ts` |
| Widgets | RSC card composition, Suspense fallbacks, client shells | `src/widgets/*/ui/*.tsx` |
| Features (Server Actions) | Mutating operations (`restartContainer`, `markAsReplied`, ...) | `src/features/container-actions/api/_runAction.ts`, `src/features/email-analysis/api/*.ts` |
| Features (jobs) | Gmail sync loop and classification orchestration | `src/features/gmail-sync/api/syncInbox.ts`, `src/features/gmail-sync/lib/classifyThreadsLoop.ts` |
| Features (read aggregators) | Cross-host summaries | `src/features/host-catalog/api/getHostsWithSummary.ts` |
| Entities (repositories) | Single-domain read APIs + upserts | `src/entities/email/api/getReplyNeeded.ts`, `src/entities/project/api/upsertProjectFromContainer.ts`, `src/entities/host/api/getHosts.ts`, `src/entities/container/api/listContainers.ts` |
| Entities (domain types) | TS types/enums shared across layers | `src/entities/*/model/types.ts` |
| Shared infra | DB client, auth, docker, LLM, env validation, push | `src/shared/lib/db/client.ts`, `src/shared/lib/auth/index.ts`, `src/shared/lib/docker/runDocker.ts`, `src/shared/lib/llm/anthropic.ts`, `src/shared/config/env.ts`, `src/shared/lib/push/index.ts` |
| Cron container | External scheduler hitting `/api/cron/*` | `cron/scheduler.js`, `cron/Dockerfile` |

## Pattern Overview

**Overall:** Feature-Sliced Design (FSD) layered on Next.js App Router with React Server Components as the default rendering model, Server Actions for mutations, and route handlers for machine-to-machine endpoints.

**Key Characteristics:**
- Strict unidirectional layer dependency `app → widgets → features → entities → shared`, enforced at lint time by `eslint-plugin-boundaries` in `eslint.config.mjs`.
- Server-first: every data path is RSC or Server Action. The `"use client"` boundary is pushed as low as possible (e.g. `src/widgets/host-dashboard/ui/HostDashboard.tsx`, `src/features/container-actions/ui/ActionButtons.tsx`, `src/widgets/email-digest/ui/ReplyCard.tsx`).
- Server-only infra is hard-gated with `import "server-only"` (DB, auth, docker, LLM, env, gmail API). Tests stub the module in `tests/setup.ts`.
- Drizzle ORM provides repository-style helpers; the schema lives in one file (`src/shared/lib/db/schema.ts`) and entities read/write through dedicated `entities/<domain>/api/*.ts` functions.
- All env vars are Zod-validated at boot in `src/shared/config/env.ts`; an invalid env throws before the server starts.

## Layers

**`app`:**
- Purpose: Routing, layout, RSC data fetching, route handlers for cron/auth/push/health.
- Location: `src/app/`
- Contains: `page.tsx`, `layout.tsx`, `api/**/route.ts`, dynamic route segments such as `servers/[hostName]/`.
- Depends on: `widgets`, `features`, `entities`, `shared`.
- Used by: Next.js runtime only.

**`widgets`:**
- Purpose: Compose entities + features into dashboard cards. Owns RSC data hydration for one panel and provides skeleton/empty/error siblings.
- Location: `src/widgets/`
- Contains: `email-digest`, `important-emails`, `server-overview`, `host-dashboard`.
- Depends on: `features`, `entities`, `shared`.
- Used by: `src/app/page.tsx`, `src/app/servers/[hostName]/page.tsx`.

**`features`:**
- Purpose: Mutations (Server Actions) and multi-entity workflows (gmail sync loop, host catalog, container actions audit).
- Location: `src/features/`
- Contains: `auth`, `container-actions`, `container-list`, `email-analysis`, `gmail-sync`, `host-catalog`.
- Depends on: other `features` (only by exception, see below), `entities`, `shared`.
- Used by: `app`, `widgets`.

**`entities`:**
- Purpose: Domain model. One slice per business concept (`container`, `digest`, `email`, `host`, `project`). Owns read APIs, idempotent upserts, types, and atomic UI (badges, rows).
- Location: `src/entities/`
- Depends on: `shared` only. **`entities → entities` is forbidden** by the boundary rules.
- Used by: `features`, `widgets`, `app`.

**`shared`:**
- Purpose: Cross-domain infrastructure — DB client, auth, env validation, docker CLI wrapper, LLM SDK, push, gmail API client, UI primitives (`HelpHint`, `ExternalLinkIcon`).
- Location: `src/shared/`
- Depends on: only itself.
- Used by: every higher layer.

### Same-layer exception: `features → features`

`eslint.config.mjs` line 38 deliberately allows `features` to import from other `features`:

```js
{ from: "features", allow: ["features", "entities", "shared"] },
```

The reason is documented in the same file (lines 8–13): `features/host-catalog` reuses the pure helper `groupByProject` from `features/container-list`. Only side-effect-free utilities should cross this boundary; UI/state coupling between features must be moved up into a widget instead.

### Forbidden: `entities → entities`

`entities` may only import `shared` (`eslint.config.mjs:39`). Cross-entity composition belongs in a feature or widget. For example, "list containers grouped by project" lives in `features/container-list/lib/groupByProject.ts`, not inside `entities/container` or `entities/project`.

## Data Flow

### Primary read path — main dashboard (`GET /`)

1. Next.js renders `src/app/page.tsx` as RSC.
2. `auth()` from `@/shared/lib/auth` resolves the database-backed NextAuth session (`src/shared/lib/auth/index.ts:27`).
3. If unauthenticated, redirect to `/login` (`src/app/page.tsx:29`).
4. Three RSC widgets are mounted inside `<Suspense>` boundaries: `EmailDigestCard`, `ImportantEmailsCard`, `ServerOverviewCard` (`src/app/page.tsx:72-80`).
5. Each widget calls an entity read API (`getReplyNeeded`, `getImportantEmails`) or a feature aggregator (`getHostsWithSummary`).
6. Entities run Drizzle queries against the shared `db` client (`src/shared/lib/db/client.ts:26`).

### Primary write path — container restart

1. User clicks `ActionButtons` in `src/features/container-actions/ui/ActionButtons.tsx`.
2. Client invokes the `restartContainer` Server Action (`src/features/container-actions/api/restartContainer.ts:4`) which delegates to `runAction("restart", input)` (`src/features/container-actions/api/_runAction.ts:45`).
3. `runAction` enforces 5 boundaries in order: Authentication → Authorization (`ADMIN_EMAILS` allowlist) → Zod input validation → host DB lookup → docker exec + audit insert (`src/features/container-actions/api/_runAction.ts:49-119`).
4. Docker is invoked via `runDocker(host.dockerContext, [action, id])` using `execFile` with no shell (`src/shared/lib/docker/runDocker.ts:13`).
5. `insertAuditLog` writes success/failed row regardless of docker outcome (`src/features/container-actions/api/insertAuditLog.ts`).
6. On success `revalidatePath('/servers/<name>')` invalidates the RSC cache (`_runAction.ts:118`).

### Primary write path — Gmail sync (cron-driven)

1. External `cron/scheduler.js` container fires `POST /api/cron/poll-gmail` hourly with `Authorization: Bearer ${CRON_BEARER_TOKEN}` (`cron/scheduler.js:48-54`).
2. `src/app/api/cron/poll-gmail/route.ts:17` verifies Bearer via `verifyCronBearer` (timing-safe, `src/shared/lib/auth/cron.ts:13`).
3. For every active user, `syncInbox(userId)` runs (`src/features/gmail-sync/api/syncInbox.ts:44`).
4. `syncInbox` resolves an access token, calls Gmail History API incrementally (`shared/api/gmail/history.ts`), persists new threads to `email_threads`, and triggers `classifyThreadsLoop`.
5. `classifyThreadsLoop` fans out to two classifiers per thread: deterministic + Haiku LLM via the Anthropic SDK pointed at the Claude Code Proxy (`src/shared/lib/llm/anthropic.ts:12`).
6. Results land in `reply_needed` and `important_emails` (`src/shared/lib/db/schema.ts:109,143`).

### Primary write path — host detail (`GET /servers/[hostName]`)

1. `src/app/servers/[hostName]/page.tsx:42` enforces auth.
2. Resolves host via `getHostByName`, then loads containers via `listContainers` (which shells out to `docker --context <hostname> ps --format json`, see `src/shared/lib/docker/listContainers.ts`).
3. Hidden-thrash guard (see Architectural Constraints below): loads `getProjects(hostId)` for display **and** `getProjectComposeKeys(hostId)` for dedup.
4. Unknown compose keys trigger `upsertProjectFromContainer` (`src/entities/project/api/upsertProjectFromContainer.ts:18`) which auto-registers new projects.
5. `groupByProject` from `features/container-list` produces `ProjectGroup[]` and is handed to the client-side `HostDashboard` widget.
6. Mutations from `HostDashboard` (restart/start/stop) go through the Server Action path above.

**State Management:**
- Server state lives in PostgreSQL; reads return fresh per-request (`export const dynamic = "force-dynamic"` on `src/app/page.tsx:25` and `src/app/servers/[hostName]/page.tsx:34`).
- Client state is local (`useState`, `useTransition`) inside individual client components. TanStack Query and Zustand are listed in `package.json` but not yet imported in `src/` — current UI relies on Server Actions + `router.refresh()`.
- The host detail page auto-refreshes every 30s via `AUTO_REFRESH_MS` in `src/widgets/host-dashboard/ui/HostDashboard.tsx:35`.

## Key Abstractions

**Drizzle repositories (entity API layer):**
- Purpose: Single-table read/write helpers exposed through `entities/<domain>/api/*.ts`.
- Examples: `src/entities/email/api/getReplyNeeded.ts`, `src/entities/project/api/upsertProjectFromContainer.ts`, `src/entities/host/api/getHosts.ts`.
- Pattern: All start with `import "server-only"`, import `db` from `@/shared/lib/db/client`, and operate on tables imported from `@/shared/lib/db/schema`. No business logic — pure persistence.

**NextAuth v5 session (database strategy):**
- Purpose: Google OAuth login with Drizzle adapter and an `ALLOWLIST_EMAILS` gate.
- Location: `src/shared/lib/auth/index.ts`
- Pattern: `auth()` is the single entry point used by every RSC and Server Action. Session is stored in the `sessions` table; `users.oauthState` tracks refresh-token validity (`active` | `reauth_required`).

**Anthropic SDK over Claude Code Proxy:**
- Purpose: LLM calls go to the user's local Claude Code CLI proxy, not Anthropic public API.
- Location: `src/shared/lib/llm/anthropic.ts`
- Pattern: `baseURL` is forced to `env.ANTHROPIC_BASE_URL`; model id is the dated `claude-haiku-4-5-20251001` constant.

**Server Action security funnel:**
- Purpose: Every container mutation passes the same 5-stage check before docker shells out.
- Location: `src/features/container-actions/api/_runAction.ts`
- Pattern: Returns a `{ ok: boolean; code?: ActionErrorCode }` discriminated union — never throws to the client. Audit row is always written.

**Cron Bearer (machine-to-machine auth):**
- Purpose: Authenticate the sidecar `cron` container without a user session.
- Location: `src/shared/lib/auth/cron.ts`
- Pattern: `timingSafeEqual` against `env.CRON_BEARER_TOKEN`. Reused by `/api/admin/reclassify` for admin-grade ops.

**Barrel `index.ts` public API per slice:**
- Purpose: Force every cross-slice import to go through the slice's facade.
- Examples: `src/entities/container/index.ts`, `src/features/container-actions/index.ts`, `src/widgets/host-dashboard/index.ts`.
- Pattern: Only the symbols intended for external use are re-exported. Deep imports from outside the slice are an FSD violation — **except** when a client component must avoid pulling server-only code via the barrel (see constraint #1 below).

## Entry Points

**HTTP request entry:**
- Location: `src/app/**/route.ts` and `src/app/**/page.tsx`
- Triggers: HTTP from browser, Next.js server, or the cron sidecar.
- Responsibilities: Auth, input parsing, RSC composition or JSON response.

**Cron sidecar:**
- Location: `cron/scheduler.js`
- Triggers: Docker container `up` + node-cron timers (`0 * * * *` and `0 8 * * *` in `Asia/Seoul`).
- Responsibilities: HTTP POST to `/api/cron/poll-gmail` and `/api/cron/morning-digest`. Holds no domain code.

**One-off scripts (operator entry):**
- Location: `src/scripts/seed-hosts.ts`, `src/scripts/seed-projects.ts`, `src/scripts/cleanup-projects.ts`, `src/scripts/fix-oauth-scope.ts`, `src/scripts/_dryrun-oauth-scope.ts`.
- Triggers: `pnpm db:seed:hosts`, `pnpm db:seed:projects`, `pnpm db:cleanup-projects [--apply]` from `package.json:16-18`.
- Responsibilities: Idempotent maintenance. Run with `tsx --conditions=react-server` to bypass the `server-only` guard.

**Drizzle CLI:**
- Location: `drizzle.config.ts`
- Triggers: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`.
- Responsibilities: Generate SQL migrations into `drizzle/` from `src/shared/lib/db/schema.ts`.

## Architectural Constraints

- **Threading:** Single Node.js event loop per process (Next.js + cron sidecar). Docker calls are child processes via `execFile`, not threads. No worker pool.
- **Global state:** `src/shared/lib/db/client.ts:8-23` caches the `postgres` client on `globalThis` to survive Next.js HMR. This is the only intentional module-level singleton. No other shared mutable state.
- **Circular imports:** None observed; the FSD layer rule prevents them by construction.
- **Boot-time env validation:** `src/shared/config/env.ts:61-66` throws synchronously if any required env var is missing or malformed, taking down the whole process before any handler runs.
- **`server-only` everywhere infra is touched:** every file importing `db`, `auth`, `runDocker`, `anthropic`, Gmail API, push, or env is marked with `import "server-only"`. Client trees must not transitively import these — see anti-patterns below.

### Gotcha #1 — Client components must NOT import entities/features via the barrel

**What happens:** Files like `src/entities/container/index.ts` re-export both client-safe UI (`ContainerRow`) and server-only APIs (`listContainers`, which uses `node:child_process`). A `"use client"` component that writes `import { type ContainerSummary } from "@/entities/container"` causes Turbopack to pull the entire barrel into the client bundle, and the build fails.

**Why it's wrong:** `import type` alone isn't enough — bundlers resolve the module graph before type erasure.

**Do this instead:** Use deep paths in client trees. Real example from `src/widgets/host-dashboard/ui/HostDashboard.tsx:20-23`:

```ts
import { ProjectGroupSection } from "@/features/container-list/ui/ProjectGroupSection";
import { StandaloneSection } from "@/features/container-list/ui/StandaloneSection";
import type { ProjectGroup } from "@/features/container-list/lib/groupByProject";
import { ActionButtons } from "@/features/container-actions/ui/ActionButtons";
```

Server-rendered pages can keep using the barrel (e.g. `src/app/servers/[hostName]/page.tsx:21-29`).

### Gotcha #2 — Integration tests must set `TEST_DATABASE_URL`

**What happens:** `tests/setup.ts:15-34` refuses to run if `DATABASE_URL` matches `192.168.0.5` or `gons.krdn.kr` (the prod hosts).

**Why it's wrong:** Tests do raw INSERT/DELETE. A previous incident left 200+ junk rows in prod `users` table.

**Do this instead:** Set `TEST_DATABASE_URL` to a disposable Postgres (e.g. `docker run -p 5999:5432 postgres:16-alpine`). Tests that need DB connectivity will `ECONNREFUSED` cleanly when no test DB is reachable; pure-unit tests still pass.

### Gotcha #3 — No locale-dependent client formatting

**What happens:** Node's ICU build has no `ko` locale; `new Date().toLocaleString("ko-KR")` returns different strings on server vs browser (`"오후 04:33"` vs `"PM 04:33"`), causing React hydration mismatches.

**Why it's wrong:** Hydration mismatch crashes the page or wipes interactivity.

**Do this instead:** Use locale-free formats (`HH:MM:SS`, ISO) in any string rendered inside a client component. Server-only RSCs may use `toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })` — see `src/app/page.tsx:34-42` for the safe pattern.

### Gotcha #4 — Compose project auto-registration replaces the whitelist

**What happens:** `src/entities/project/api/upsertProjectFromContainer.ts:18-34` inserts every previously-unseen `compose_project` label into the `projects` table on first sight. `src/entities/project/config/knownComposeProjects.ts` is **not** a gate anymore — it is only used by `seed-projects.ts` (Korean metadata hints) and `cleanup-projects.ts` (pinned protection).

**Why it's wrong (as a mental model):** Treating `KNOWN_COMPOSE_PROJECTS_BY_HOST` as a gate produces "container exists but not shown" bugs.

**Do this instead:** Add a key to that file only when you want a Korean `displayName` / category / URL. Containers always render via the auto-upsert path.

### Gotcha #5 — Hidden-project Drizzle thrash

**What happens:** The host detail page must load both visible projects (for display) **and** hidden compose keys (for dedup):

```ts
// src/app/servers/[hostName]/page.tsx:65-68
const [visibleProjects, allComposeKeys] = await Promise.all([
  getProjects(host.id),             // isHidden = false only
  getProjectComposeKeys(host.id),   // all keys, hidden included
]);
```

**Why it's wrong:** If only `getProjects` is used, every hidden project's compose key appears "unknown" on every request, retriggering `upsertProjectFromContainer` and its `onConflictDoUpdate` every render.

**Do this instead:** Always pair the display query with the full-key query for dedup. The same pattern is implemented inside `src/features/host-catalog/api/getHostsWithSummary.ts:25-32`.

## Anti-Patterns

### Cross-entity import

**What happens:** `entities/email` importing from `entities/host`.
**Why it's wrong:** Violates the `entities → shared` rule in `eslint.config.mjs:39` and creates implicit coupling.
**Do this instead:** Lift the composition into `features/<name>/api/*.ts` (as done in `src/features/host-catalog/api/getHostsWithSummary.ts`).

### Deep import bypassing a barrel from another slice

**What happens:** Server code reaches into `src/features/gmail-sync/lib/full-rescan.ts` from outside the slice.
**Why it's wrong:** Defeats the public-API contract; refactors break callers silently.
**Do this instead:** Re-export from `src/features/gmail-sync/index.ts` and import from `@/features/gmail-sync`. Deep imports are reserved for the **client-bundle** workaround in Gotcha #1.

### Calling Anthropic from outside `shared/lib/llm`

**What happens:** Instantiating `new Anthropic({...})` ad-hoc inside a feature.
**Why it's wrong:** Bypasses the proxy baseURL and the pinned model id; produces "unknown provider for model" responses.
**Do this instead:** Import `anthropic` and `HAIKU_MODEL` from `src/shared/lib/llm/anthropic.ts`.

### Throwing from a Server Action

**What happens:** Throwing inside `restartContainer` / `markAsReplied` instead of returning a result union.
**Why it's wrong:** Next.js surfaces a generic 500 to the client and skips the audit-log path.
**Do this instead:** Match `src/features/container-actions/api/_runAction.ts`'s `{ ok, code, message }` pattern.

## Error Handling

**Strategy:** Errors are surfaced as typed result objects in mutations and as RSC error UI for reads.

**Patterns:**
- Server Actions return `{ ok: boolean; code?: ActionErrorCode; message?: string }`. See `ActionResult` in `src/features/container-actions/api/_runAction.ts:41-43`.
- Read aggregators capture per-host errors instead of failing the whole page (e.g. `src/features/host-catalog/api/getHostsWithSummary.ts:62-70` returns `daemonOk: false` with an `errorMessage`).
- RSC pages place an `error.tsx` next to `page.tsx` for unhandled errors (`src/app/servers/[hostName]/error.tsx`) and a `loading.tsx` for Suspense fallbacks (`src/app/servers/[hostName]/loading.tsx`).
- Docker stderr is truncated to 500 chars before being persisted in `audit_logs.error_message` (`src/features/container-actions/api/_runAction.ts:92`).
- Cron handler logs per-user failures and continues with the next user (`src/app/api/cron/poll-gmail/route.ts:46-55`).

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` to stdout, captured by Docker. No structured logger. Sensitive Docker stderr is masked/truncated before logging via `src/shared/lib/docker/maskEnv.ts` and the 500-char cap in `_runAction.ts`.

**Validation:** Zod everywhere user input enters the server:
- Env at boot — `src/shared/config/env.ts`
- Server Action input — `_runAction.ts:25-30`
- Push subscribe body — `src/app/api/push/subscribe/route.ts:10-16`
- Admin reclassify body — `src/app/api/admin/reclassify/route.ts:20-24`

**Authentication:** Two distinct mechanisms:
1. Google OAuth + DB session via NextAuth (`src/shared/lib/auth/index.ts`) for human users; allowlist enforced in the `signIn` callback (`auth/index.ts:57-64`).
2. Bearer token for cron and admin endpoints (`src/shared/lib/auth/cron.ts:13`), reused by `/api/cron/*` and `/api/admin/reclassify`.

Authorization for container mutations uses `ADMIN_EMAILS` evaluated by `isAdmin` (`src/features/container-actions/lib/isAdmin.ts`). The page-level `adminFlag` (`src/app/servers/[hostName]/page.tsx:49`) is for UI only — the Server Action re-checks server-side.

**Cache invalidation:** Server Actions call `revalidatePath` for the affected route (`src/features/container-actions/api/_runAction.ts:118`). Page-level `dynamic = "force-dynamic"` opts every dashboard page out of static caching.

---

*Architecture analysis: 2026-05-11*
