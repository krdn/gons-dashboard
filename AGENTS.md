# Repository Guidelines

## Project Structure & Module Organization

This pnpm workspace contains the Next.js application in `apps/dashboard`, the Dockerized scheduler in `apps/cron`, and reusable TypeScript packages in `packages/`. Dashboard code follows Feature-Sliced Design under `apps/dashboard/src`: dependencies flow from `app` to `widgets`, `features`, `entities`, then `shared`. Expose slice APIs through barrels or explicit `server.ts`/`client.ts` entry points; ESLint enforces these boundaries. Database schema and migrations live in `apps/dashboard/drizzle`, static assets in `apps/dashboard/public`, and operational or design documentation in `docs/`.

## Build, Test, and Development Commands

- `pnpm install` installs all workspace dependencies with pnpm 10.
- `pnpm dev` starts the dashboard with Turbopack at `http://localhost:3020`.
- `pnpm typecheck` runs strict TypeScript checks across workspaces.
- `pnpm lint` runs ESLint, including FSD dependency rules.
- `pnpm test` runs all Vitest suites once.
- `pnpm build` validates the production Next.js bundle and catches server/client boundary errors missed by linting.
- `pnpm format` applies Prettier to dashboard TypeScript, TSX, CSS, and Markdown.
- `pnpm db:generate` creates Drizzle migrations after schema changes; review generated SQL before `pnpm db:migrate`.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, semicolons, double quotes, and trailing commas as produced by Prettier. Name React components and exported types in `PascalCase`, functions and variables in `camelCase`, and feature directories in kebab-case (for example, `features/email-reply`). Keep code identifiers in English; repository documentation may be Korean. Client components must import browser-safe entry points such as `@/entities/container/client` rather than server barrels.

## Testing Guidelines

Vitest is the unit and integration test framework, with Testing Library for React. Name tests `*.test.ts` or `*.test.tsx`; place dashboard tests in `apps/dashboard/tests` or beside source, and package tests beside source or in `packages/*/tests`. Add regression tests for behavior changes. Database integration tests require a non-production `TEST_DATABASE_URL`; test setup rejects production hosts.

## Commit & Pull Request Guidelines

History follows Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, and `chore:`. Keep commits focused and use imperative summaries; include the issue or PR number when relevant. Pull requests should explain intent and verification, link affected issues, note migrations or configuration changes, and include screenshots for UI work. Before requesting review, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.

## Security & Configuration

Copy `.env.example` to `.env`; never commit secrets, tokens, or production credentials. Production seed and cleanup commands require explicit acknowledgement—consult `CLAUDE.md` and `docs/RUNBOOK.md` before operational changes.
