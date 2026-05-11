# Technology Stack

**Analysis Date:** 2026-05-11

## Languages

**Primary:**
- TypeScript ^5 (strict mode, `target: ES2020`, `moduleResolution: bundler`) — all application code under `src/`. Config: `tsconfig.json`.

**Secondary:**
- JavaScript (ESM) — used only for the cron worker `cron/scheduler.js`.
- SQL — Drizzle-generated migrations under `drizzle/` (e.g. `drizzle/0004_rapid_zzzax.sql`, `drizzle/0005_silent_la_nuit.sql`).
- CSS (Tailwind v4 + tokens) — `src/app/globals.css`.

## Runtime

**Environment:**
- Node.js 24 (alpine) — pinned in `Dockerfile` (`FROM node:24-alpine`) and CI (`.github/workflows/ci.yml`, `node-version: 24`).
- Next.js 16 App Router with React Server Components + Server Actions.
- Turbopack dev server (`next dev --turbopack -p 3020`).
- Standalone output for Docker (`next.config.ts` → `output: "standalone"`).

**Package Manager:**
- pnpm 10.28.2 (declared in `package.json` → `packageManager` and Dockerfile `corepack prepare pnpm@10.28.2 --activate`).
- Lockfile: `pnpm-lock.yaml` (present, `--frozen-lockfile` in CI/Docker).
- Workspace: `pnpm-workspace.yaml` (no sub-packages, only `ignoredBuiltDependencies: [sharp, unrs-resolver]`).
- Sub-package: `cron/package.json` — separate npm install in the cron Docker image (`node-cron` only).

## Frameworks

**Core:**
- Next.js `16.2.6` — App Router, RSC, Server Actions, route handlers under `src/app/api/`.
- React `19.2.4` + React DOM `19.2.4`.
- NextAuth (Auth.js) `^5.0.0-beta.25` — Google provider, Drizzle adapter, database session strategy. Configured in `src/shared/lib/auth/index.ts`.
- Drizzle ORM `^0.38.3` — Postgres schema in `src/shared/lib/db/schema.ts`, client in `src/shared/lib/db/client.ts`.
- `postgres` `^3.4.5` — node-postgres alternative driver (declared in `next.config.ts` → `serverExternalPackages: ["postgres"]`).

**Testing:**
- Vitest `^4.1.5` + `@vitest/ui` `^4.1.5` — config: `vitest.config.ts` (node env, `TZ: Asia/Seoul`, setup file `tests/setup.ts`).
- `@testing-library/react` `^16.3.2` + `jsdom` `^29.1.1` — available but most tests are server-side unit tests under `tests/*.test.ts`.

**Build/Dev:**
- Turbopack (dev only, via `next dev --turbopack`).
- TypeScript compiler `^5` (`pnpm typecheck` → `tsc --noEmit`).
- ESLint `^9` + `eslint-config-next` `16.2.6` + `eslint-plugin-boundaries` `^5.0.1` — FSD layer rules in `eslint.config.mjs`.
- Prettier `^3.4.2` + `prettier-plugin-tailwindcss` `^0.6.9` — config `.prettierrc.json` (2-space, double quotes, trailing comma all, printWidth 80).
- `drizzle-kit` `^0.30.1` — schema generation/migration, config `drizzle.config.ts`.
- `tsx` `^4.21.0` — runs Drizzle seed/cleanup scripts under `src/scripts/` (`--conditions=react-server` flag in `package.json` scripts).
- `dotenv` `^17.4.2` — loaded by `drizzle.config.ts` and scripts.

## Key Dependencies

**Critical:**
- `@anthropic-ai/sdk` `^0.36.3` — LLM client, pointed at Claude Code CLI Proxy via `ANTHROPIC_BASE_URL`. Client in `src/shared/lib/llm/anthropic.ts` (model `claude-haiku-4-5-20251001`).
- `next-auth` `^5.0.0-beta.25` + `@auth/drizzle-adapter` `^1.7.4` — Google OAuth + Drizzle session/account persistence.
- `drizzle-orm` `^0.38.3` + `postgres` `^3.4.5` — Postgres driver and ORM.
- `zod` `^3.24.1` — env validation (`src/shared/config/env.ts`), LLM/API response schemas, route input validation.
- `web-push` `^3.6.7` (+ `@types/web-push` `^3.6.4`) — VAPID push, used in `src/shared/lib/push/index.ts`.
- `@tanstack/react-query` `^5.62.7` — declared client-side data fetching (in dependencies; not used in route/widget code reviewed here).
- `zustand` `^5.0.2` — client state store (declared).
- `server-only` `^0.0.1` — enforces server-only modules (used at the top of every server module in `src/shared/lib/**`, `src/entities/**/api/*`).

**Infrastructure:**
- `dotenv` `^17.4.2` — `drizzle.config.ts` only.
- `node-cron` `^3.0.3` — cron container (`cron/package.json`).
- `@tailwindcss/postcss` `^4` + `tailwindcss` `^4` — `postcss.config.mjs`, plus tokens in `src/app/globals.css`. Light mode is fixed (`@variant dark (&:where(.dark, .dark *))`).

## Configuration

**Environment:**
- All env vars validated at boot by Zod in `src/shared/config/env.ts` (server-only). Missing/invalid values throw before the app starts.
- `.env.example` is the canonical list of variables; `.env` is gitignored.
- Build-time placeholders for env vars are injected by `Dockerfile` and `.github/workflows/ci.yml` so that the Zod check passes during page-data collection (real values come from `docker-compose.yml` at runtime).

**Env vars required (names only — see `.env.example`, `src/shared/config/env.ts`):**

| Group | Variable | Validation |
|-------|----------|------------|
| Node | `NODE_ENV` | enum, default `development` |
| Postgres | `DATABASE_URL` | URL |
| Redis | `REDIS_URL` | URL |
| NextAuth | `NEXTAUTH_SECRET` | min 32 chars |
| NextAuth | `NEXTAUTH_URL` | URL |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | non-empty |
| LLM proxy | `ANTHROPIC_BASE_URL` | URL |
| LLM proxy | `ANTHROPIC_API_KEY` | non-empty |
| Cron auth | `CRON_BEARER_TOKEN` | min 32 chars |
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | optional, non-empty |
| Web Push | `VAPID_SUBJECT` | optional, must start with `mailto:` |
| Ops alert | `OPS_NOTIFY_EMAIL` | optional, email |
| At-rest | `PG_ENCRYPTION_KEY` | optional, min 32 chars (refresh token pgcrypto) |
| Allowlist | `ALLOWLIST_EMAILS` | comma-separated, non-empty |
| Server monitor | `DOCKER_DEFAULT_CONTEXT` | default `home-server` |
| Server monitor | `DOCKER_CMD_TIMEOUT_MS` | coerced number, default `10000` |
| Server monitor | `ADMIN_EMAILS` | comma-separated, non-empty |
| Timezone | `TZ` | literal `Asia/Seoul` |

Cron container additionally reads `APP_URL` (`http://app:3020` internally) and `CRON_BEARER_TOKEN` — see `cron/scheduler.js`.

**Build:**
- `next.config.ts` — `output: "standalone"`, `serverExternalPackages: ["postgres"]`.
- `tsconfig.json` — path alias `@/* → ./src/*`, strict mode, `jsx: react-jsx`, `moduleResolution: bundler`.
- `eslint.config.mjs` — extends `next/core-web-vitals` + `next/typescript`, layered with `eslint-plugin-boundaries` for FSD (`app → widgets → features → entities → shared`; `features → features` allowed).
- `.prettierrc.json` — 2-space, double-quotes, trailing-comma `all`, printWidth 80, Tailwind plugin.
- `vitest.config.ts` — `tests/**/*.test.ts`, `setupFiles: ./tests/setup.ts`, `TZ: Asia/Seoul`, `@` alias to `src/`.
- `drizzle.config.ts` — schema `./src/shared/lib/db/schema.ts`, out `./drizzle`, `dialect: postgresql`, `strict: true`, `verbose: true`.
- `postcss.config.mjs` — `@tailwindcss/postcss` only.

## Platform Requirements

**Development:**
- Node 24, pnpm 10.28.2 (corepack).
- Postgres reachable at `DATABASE_URL` (in `.env.example`, points to `192.168.0.5:5440`).
- Redis reachable at `REDIS_URL` (declared; runtime usage not yet observed in shared lib code).
- `docker` CLI on PATH with a configured context (e.g. `home-server`) — required for server-monitor features (`src/shared/lib/docker/runDocker.ts` calls `docker --context <name>`).
- Anthropic-compatible proxy reachable at `ANTHROPIC_BASE_URL` (default `http://192.168.0.5:8317`).
- Local test DB (optional): `docker run -p 5999:5432 postgres:16-alpine` + `TEST_DATABASE_URL` — `tests/setup.ts` hard-blocks prod DB hosts.

**Production:**
- Docker host `192.168.0.5` (context alias `home-server`, accessed by app users via `https://gons.krdn.kr`).
- `docker-compose.yml` defines four services:
  - `gons-dashboard-postgres` — `postgres:16-alpine`, port `5440:5432`, volume `gons_dashboard_pgdata`, `TZ=Asia/Seoul`, `PGTZ=Asia/Seoul`.
  - `gons-dashboard-redis` — `redis:7-alpine`, port `6390:6379`, AOF persistence, volume `gons_dashboard_redisdata`.
  - `gons-dashboard-app` — `ghcr.io/krdn/gons-dashboard:${APP_IMAGE_TAG:-latest}`, port `3020`, health `GET /api/health`, depends on healthy postgres + redis.
  - `gons-dashboard-cron` — `ghcr.io/krdn/gons-dashboard-cron:${APP_IMAGE_TAG:-latest}`, depends on healthy app, calls `http://app:3020`.
- CI: GitHub Actions `.github/workflows/ci.yml` — lint + typecheck + build sanity (with placeholder envs); on push to `main`, builds and pushes both images to GHCR with `latest` and `sha-<sha>` tags.

---

*Stack analysis: 2026-05-11*
