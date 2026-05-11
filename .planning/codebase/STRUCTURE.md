# Codebase Structure

**Analysis Date:** 2026-05-11

## Directory Layout

```
gons-dashboard/
├── src/
│   ├── app/                       # Next.js App Router — pages, layouts, route handlers
│   │   ├── api/
│   │   │   ├── admin/reclassify/  # Bearer-gated manual reclassify
│   │   │   ├── auth/[...nextauth]/# NextAuth v5 mount
│   │   │   ├── cron/morning-digest/
│   │   │   ├── cron/poll-gmail/
│   │   │   ├── health/            # Docker healthcheck
│   │   │   └── push/subscribe/    # Web Push subscribe/unsubscribe
│   │   ├── login/                 # Public login page
│   │   ├── servers/[hostName]/    # Host detail (page/loading/error)
│   │   ├── globals.css            # Tailwind v4 entry + design tokens
│   │   ├── layout.tsx             # Root layout
│   │   └── page.tsx               # Dashboard root
│   ├── widgets/                   # Composition layer (RSC cards + client shells)
│   │   ├── email-digest/{ui,index.ts}
│   │   ├── host-dashboard/{ui,index.ts}
│   │   ├── important-emails/{ui,index.ts}
│   │   └── server-overview/{ui,index.ts}
│   ├── features/                  # User-facing flows & Server Actions
│   │   ├── auth/                  # Reserved slice (currently empty barrel)
│   │   ├── container-actions/{api,lib,ui,index.ts}
│   │   ├── container-list/{lib,ui,index.ts}
│   │   ├── email-analysis/{api,lib,model,ui,index.ts}
│   │   ├── gmail-sync/{api,lib,index.ts}
│   │   └── host-catalog/{api,index.ts}
│   ├── entities/                  # Domain repositories + atomic UI + types
│   │   ├── container/{api,model,ui,index.ts}
│   │   ├── digest/{lib,model,ui,index.ts}
│   │   ├── email/{api,lib,model,ui,index.ts}
│   │   ├── host/{api,model,ui,index.ts}
│   │   └── project/{api,config,lib,model,ui,index.ts}
│   ├── shared/                    # Cross-domain infra
│   │   ├── api/gmail/             # Gmail REST client
│   │   ├── config/                # env.ts (Zod), tokens.ts (design tokens)
│   │   ├── lib/
│   │   │   ├── auth/              # NextAuth init + cron Bearer
│   │   │   ├── db/                # Drizzle client + schema
│   │   │   ├── docker/            # execFile-based docker CLI wrapper
│   │   │   ├── email-format/
│   │   │   ├── llm/               # Anthropic SDK (Claude Code Proxy)
│   │   │   ├── push/              # web-push VAPID
│   │   │   └── url/               # safeExternalUrl
│   │   └── ui/                    # HelpHint, ExternalLinkIcon
│   └── scripts/                   # Operator scripts (tsx --conditions=react-server)
├── tests/                         # Vitest unit + integration suites
├── drizzle/                       # Generated migrations + snapshots
│   └── meta/                      # _journal.json + per-migration snapshots
├── docs/                          # Specs, plans, runbook, agent docs
│   ├── RUNBOOK.md
│   ├── agents/                    # domain.md, issue-tracker.md, triage-labels.md
│   └── superpowers/{specs,plans}/
├── cron/                          # Sidecar node-cron container
│   ├── scheduler.js
│   ├── package.json
│   └── Dockerfile
├── public/                        # Static assets served by Next.js
├── CLAUDE.md                      # Project agent instructions (authoritative)
├── TODOS.md                       # v0.1 backlog
├── README.md
├── LICENSE
├── package.json                   # pnpm scripts, deps
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.json                  # paths: { "@/*": ["./src/*"] }
├── next.config.ts                 # standalone output + serverExternalPackages
├── eslint.config.mjs              # FSD boundary rules (eslint-plugin-boundaries)
├── vitest.config.ts               # TZ=Asia/Seoul + tests/setup.ts
├── drizzle.config.ts              # Drizzle Kit config (schema → drizzle/)
├── docker-compose.yml             # Local + prod compose definition
├── Dockerfile                     # App container (standalone build)
├── postcss.config.mjs             # Tailwind v4 PostCSS plugin
├── .prettierrc.json
├── .env.example                   # Required env vars (no secrets committed)
└── .github/                       # GitHub Actions workflows
```

## Directory Purposes

**`src/app/`:**
- Purpose: Next.js App Router. Routing, layouts, Server Components, route handlers.
- Contains: `page.tsx`, `layout.tsx`, `globals.css`, dynamic segments, `api/**/route.ts`.
- Key files: `src/app/page.tsx`, `src/app/servers/[hostName]/page.tsx`, `src/app/api/cron/poll-gmail/route.ts`, `src/app/api/cron/morning-digest/route.ts`, `src/app/api/health/route.ts`, `src/app/api/push/subscribe/route.ts`, `src/app/api/admin/reclassify/route.ts`, `src/app/api/auth/[...nextauth]/route.ts`.

**`src/widgets/`:**
- Purpose: Dashboard composition. Each widget owns one card's RSC + skeleton + empty/error states + a thin client shell when interactivity is needed.
- Contains: `email-digest`, `host-dashboard`, `important-emails`, `server-overview`.
- Each slice exposes a public surface via `index.ts` (e.g. `src/widgets/email-digest/index.ts` exports `EmailDigestCard`, `EmailDigestSkeleton`, `EmailDigestEmpty`, `PushSubscribeButton`).

**`src/features/`:**
- Purpose: User-facing actions and multi-step workflows. Server Actions live here.
- Contains: `auth` (reserved, empty barrel), `container-actions`, `container-list`, `email-analysis`, `gmail-sync`, `host-catalog`.
- Key files: `src/features/container-actions/api/_runAction.ts` (security funnel), `src/features/gmail-sync/api/syncInbox.ts`, `src/features/email-analysis/api/markAsReplied.ts`, `src/features/host-catalog/api/getHostsWithSummary.ts`, `src/features/container-list/lib/groupByProject.ts`.

**`src/entities/`:**
- Purpose: Domain primitives. One slice per business concept; owns reads, idempotent upserts, types, atomic UI.
- Contains: `container`, `digest`, `email`, `host`, `project`.
- Key files: `src/entities/email/api/getReplyNeeded.ts`, `src/entities/email/api/classifyImportant.ts`, `src/entities/project/api/upsertProjectFromContainer.ts`, `src/entities/project/api/getProjectComposeKeys.ts`, `src/entities/host/api/getHosts.ts`, `src/entities/container/api/listContainers.ts`.

**`src/shared/`:**
- Purpose: Cross-domain infrastructure. Anything depended on by more than one entity belongs here.
- Contains:
  - `api/gmail/` — Gmail REST helpers (`auth.ts`, `messages.ts`, `history.ts`, `modify.ts`, `errors.ts`, `headers.ts`).
  - `config/env.ts` — Zod-validated env. **Single boot-time validation point.**
  - `config/tokens.ts` — TS mirror of the CSS design tokens.
  - `lib/auth/index.ts` — NextAuth v5 + Drizzle adapter + allowlist.
  - `lib/auth/cron.ts` — Bearer verification for cron/admin endpoints.
  - `lib/db/client.ts` — Single Drizzle client (HMR-safe singleton).
  - `lib/db/schema.ts` — All tables; consumed by `entities/*/api/*`.
  - `lib/docker/runDocker.ts` — `execFile`-based docker CLI wrapper (no shell interpolation).
  - `lib/llm/anthropic.ts` — Anthropic SDK pointed at Claude Code Proxy + `HAIKU_MODEL`.
  - `lib/push/index.ts` — web-push VAPID send.
  - `lib/url/safeExternalUrl.ts`, `lib/email-format/`.
  - `ui/HelpHint.tsx`, `ui/ExternalLinkIcon.tsx` — primitive components only.

**`src/scripts/`:**
- Purpose: Operator-run maintenance and seeding. Not part of the Next.js runtime.
- Contains: `seed-hosts.ts`, `seed-projects.ts`, `cleanup-projects.ts`, `cleanup-projects.lib.ts`, `fix-oauth-scope.ts`, `_dryrun-oauth-scope.ts`.
- Entry: `pnpm db:seed:hosts`, `pnpm db:seed:projects`, `pnpm db:cleanup-projects [--apply]`. All use `tsx --conditions=react-server` to bypass `server-only` guards.

**`tests/`:**
- Purpose: Vitest unit + integration tests. One file per module under test.
- Contains: `setup.ts` (prod DB guard + `server-only` shim), plus suites like `container-actions.test.ts`, `host-api.test.ts`, `project-api.test.ts`, `cron-tz.test.ts`, `docker-*.test.ts`, `important-classify-cycle.test.ts`.
- Key file: `tests/setup.ts` — refuses to run if `DATABASE_URL` matches the prod host patterns.

**`drizzle/`:**
- Purpose: Generated SQL migrations and snapshot metadata. Source of truth for schema evolution.
- Contains: Sequential `NNNN_*.sql` migrations and `meta/_journal.json` + `meta/NNNN_snapshot.json`.
- Generated: Yes — `pnpm db:generate` from `src/shared/lib/db/schema.ts`.
- Committed: Yes — migrations are checked in.

**`docs/`:**
- Purpose: Human-facing docs.
- Contains:
  - `docs/RUNBOOK.md` — operational procedures (secret rotation, OAuth refresh).
  - `docs/agents/` — `domain.md`, `issue-tracker.md`, `triage-labels.md` for agent-assisted workflows.
  - `docs/superpowers/specs/` — design specs (`YYYY-MM-DD-topic.md`).
  - `docs/superpowers/plans/` — implementation plans.

**`cron/`:**
- Purpose: Standalone scheduler container; does **not** import `src/` code.
- Contains: `scheduler.js` (node-cron), `Dockerfile`, `package.json`.
- Boundary: Communicates with the app over HTTP using `CRON_BEARER_TOKEN`.

**`public/`:**
- Purpose: Static assets served as-is by Next.js (currently empty).
- Committed: Yes.

**`.github/`:**
- Purpose: CI workflows (Lint & Type Check + Build & Push Docker Images on `main`).

## Key File Locations

**Entry points:**
- `src/app/page.tsx` — Dashboard root (RSC, auth-gated).
- `src/app/servers/[hostName]/page.tsx` — Host detail (RSC + client shell).
- `src/app/api/cron/poll-gmail/route.ts` — Hourly Gmail sync trigger.
- `src/app/api/cron/morning-digest/route.ts` — 08:00 KST push digest.
- `src/app/api/health/route.ts` — Docker healthcheck.
- `cron/scheduler.js` — Sidecar entry.

**Configuration:**
- `src/shared/config/env.ts` — Zod env schema (single source of truth).
- `src/shared/config/tokens.ts` — TS design tokens.
- `next.config.ts` — `output: "standalone"`, `serverExternalPackages: ["postgres"]`.
- `tsconfig.json` — `paths: { "@/*": ["./src/*"] }`, strict mode.
- `eslint.config.mjs` — FSD boundaries.
- `vitest.config.ts` — `TZ=Asia/Seoul`, `tests/setup.ts`.
- `drizzle.config.ts` — Drizzle Kit config.
- `docker-compose.yml` — App + Postgres + Redis + cron services.
- `.env.example` — Required vars (no secrets).

**Core logic:**
- `src/shared/lib/db/schema.ts` — All tables.
- `src/shared/lib/db/client.ts` — Drizzle client singleton.
- `src/shared/lib/auth/index.ts` — NextAuth v5 init.
- `src/shared/lib/docker/runDocker.ts` — Docker CLI wrapper.
- `src/shared/lib/llm/anthropic.ts` — LLM client.
- `src/features/container-actions/api/_runAction.ts` — Server Action security funnel.
- `src/features/gmail-sync/api/syncInbox.ts` — Per-user Gmail sync.
- `src/features/host-catalog/api/getHostsWithSummary.ts` — Cross-host aggregator.
- `src/features/container-list/lib/groupByProject.ts` — Pure compose grouping helper.

**Testing:**
- `tests/setup.ts` — Prod DB guard + `server-only` shim.
- `tests/container-actions.test.ts`, `tests/container-actions-admin.test.ts` — Server Action security.
- `tests/cron-tz.test.ts` — KST cron correctness.
- `tests/docker-*.test.ts` — Docker CLI parser + wrapper.
- `tests/important-classify-cycle.test.ts`, `tests/llm-classify-important.test.ts` — LLM classification flow.

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g. `ContainerRow.tsx`, `HostDashboard.tsx`, `EmailDigestCard.tsx`).
- Server Actions / repository helpers: `camelCase.ts` matching the exported function name (e.g. `restartContainer.ts`, `getReplyNeeded.ts`, `upsertProjectFromContainer.ts`).
- Pure helpers / libs: `camelCase.ts` (e.g. `groupByProject.ts`, `collectHostPorts.ts`).
- Types: `model/types.ts` per slice.
- Configs at root: `kebab-case.config.{ts,mjs}` (e.g. `next.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`).
- Tests: `<subject>.test.ts` under `tests/`.
- Drizzle migrations: `NNNN_<auto-name>.sql` (auto-generated).
- Docs: `YYYY-MM-DD-<topic>.md` for specs/plans; `UPPERCASE.md` for top-level docs (`CLAUDE.md`, `README.md`, `TODOS.md`).

**Directories:**
- Slices: `kebab-case` (e.g. `email-digest`, `container-actions`, `host-catalog`).
- Sub-folders: `lowercase` and conventional FSD names (`api`, `ui`, `lib`, `model`, `config`).

**Identifiers (TS code):**
- Functions and variables: `camelCase` (e.g. `getReplyNeeded`, `runDocker`).
- React components and types: `PascalCase` (e.g. `ContainerRow`, `ProjectGroup`, `HostSummary`).
- Constants: `UPPER_SNAKE_CASE` (e.g. `HAIKU_MODEL`, `AUTO_REFRESH_MS`, `KNOWN_COMPOSE_PROJECTS_BY_HOST`).
- Booleans on objects: prefer `is*` / `has*` (e.g. `isHidden`, `isStale`, `daemonOk`).

**CSS:**
- Tailwind utility classes inline.
- Design tokens declared in `src/app/globals.css` as CSS custom properties using `kebab-case` names (e.g. `--color-accent`, `--color-text-muted`).
- Light-mode locked; dark variant deliberately gated by `@variant dark (&:where(.dark, .dark *))` to ignore `prefers-color-scheme`.

## Public API Rule (FSD barrels)

Every slice exposes its public surface through a single `index.ts` file. External code imports from the slice root, never from internal subpaths.

```ts
// Good
import { restartContainer, isAdmin, AuditLogPanel } from "@/features/container-actions";
import { getReplyNeeded, type ReplyNeededItem } from "@/entities/email";

// Bad — bypasses public contract
import { restartContainer } from "@/features/container-actions/api/restartContainer";
```

**Exception:** Client (`"use client"`) components must use deep paths into `entities` / `features` to avoid pulling server-only barrel exports into the client bundle. See `ARCHITECTURE.md` "Gotcha #1" and the real example in `src/widgets/host-dashboard/ui/HostDashboard.tsx:20-23`.

## Dependency Boundary Enforcement

ESLint enforces FSD direction via `eslint-plugin-boundaries` (`eslint.config.mjs`):

| From      | Allowed targets                                  |
|-----------|--------------------------------------------------|
| `app`     | `widgets`, `features`, `entities`, `shared`      |
| `widgets` | `features`, `entities`, `shared`                 |
| `features`| `features`, `entities`, `shared` (same-layer ok) |
| `entities`| `shared`                                         |
| `shared`  | `shared`                                         |

- `features → features` is the only same-layer exception. It exists solely to let `features/host-catalog` reuse `features/container-list/lib/groupByProject` (pure helper). UI/state sharing between features should be promoted to a widget instead.
- `entities → entities` is **forbidden**. Cross-entity composition belongs in a feature.
- Verify with `pnpm lint`.

## Where to Add New Code

**New entity (e.g. `calendar`):**
- Folder: `src/entities/calendar/` with `model/types.ts`, `api/*.ts`, optionally `ui/`, `lib/`, `config/`.
- Barrel: `src/entities/calendar/index.ts` re-exporting the public surface.
- DB tables: add to `src/shared/lib/db/schema.ts`, run `pnpm db:generate`, commit the new file under `drizzle/`.

**New feature (e.g. `calendar-sync`):**
- Folder: `src/features/calendar-sync/` with `api/` (Server Actions / jobs), `lib/` (pure helpers), `ui/` (client components).
- Server Actions: file starts with `"use server"` and `import "server-only"`, returns a typed result union (`{ ok, code, message }`), never throws to the client. Mirror `src/features/container-actions/api/_runAction.ts`.
- Barrel: `src/features/calendar-sync/index.ts`.

**New widget (e.g. `calendar-card`):**
- Folder: `src/widgets/calendar-card/ui/` with the RSC card + skeleton + empty/error siblings.
- Mount from `src/app/page.tsx` inside `<Suspense fallback={<...Skeleton />}>`.

**New dashboard tile:**
- Pick a widget under `src/widgets/`, add an entry to the JSX grid in `src/app/page.tsx` (lines 70-82) with its own `<Suspense>`.

**New cron job:**
- Add a route handler under `src/app/api/cron/<name>/route.ts`, gate with `verifyCronBearer`, and schedule from `cron/scheduler.js`.

**New script:**
- Add `src/scripts/<name>.ts` starting with `import "dotenv/config";` (top-most line, before any `@/*` import — required for env validation to see the values).
- Add a `package.json` script using `tsx --conditions=react-server`.

**New shared utility:**
- Add to `src/shared/lib/<area>/`. If it touches infra, start with `import "server-only";`.
- If it's a UI primitive, add to `src/shared/ui/` (e.g. `HelpHint.tsx`).

**New test:**
- Create `tests/<subject>.test.ts`. Tests run under `TZ=Asia/Seoul`. Integration tests against DB require `TEST_DATABASE_URL` (see `tests/setup.ts`).

**New DB column / table:**
- Edit `src/shared/lib/db/schema.ts`.
- Run `pnpm db:generate` to produce a new `drizzle/NNNN_*.sql` (commit it).
- Apply with `pnpm db:migrate` (against the target DB pointed to by `DATABASE_URL`).

## Special Directories

**`drizzle/`:**
- Purpose: Generated SQL migrations + snapshot metadata.
- Generated: Yes (`pnpm db:generate`).
- Committed: Yes.
- Never hand-edit `meta/_journal.json` or snapshot files. Edit `schema.ts` and regenerate.

**`.next/`, `node_modules/`, `tsconfig.tsbuildinfo`:**
- Generated: Yes.
- Committed: No (in `.gitignore`).

**`.env`, `.env.bak.*`:**
- Generated: No.
- Committed: No. Secrets never go in the repo (CLAUDE.md security note).

**`.claude/`, `.agents/`, `.codex/`, `.gstack/`, `.memsearch/`, `.planning/`:**
- Purpose: Agent / tooling state local to this project.
- Committed: Selectively (see `.gitignore`).

**`public/`:**
- Currently empty placeholder for static assets.

**`docs/superpowers/`:**
- Specs and plans live here under date-prefixed filenames.

---

*Structure analysis: 2026-05-11*
