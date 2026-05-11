# Coding Conventions

**Analysis Date:** 2026-05-11

## Naming Patterns

**Files:**
- React components / classes: `PascalCase.tsx` — e.g. `HostDashboard.tsx`, `ReplyCard.tsx`, `ActionButtons.tsx`
- Functions / utilities / API modules: `camelCase.ts` — e.g. `runDocker.ts`, `inspectContainer.ts`, `getImportantEmails.ts`, `classifyImportant.ts`
- Folder-private modules (not exported via barrel): underscore prefix — e.g. `src/features/container-actions/api/_runAction.ts`
- Test files: kebab-case mirroring the unit under test — `<feature>-<scenario>.test.ts` in `tests/` (flat)
- Config singletons: lowercase — `eslint.config.mjs`, `vitest.config.ts`, `drizzle.config.ts`, `next.config.ts`

**Functions:**
- `camelCase`, verb-led — `runDocker`, `classifyImportantWithLlm`, `upsertProjectFromContainer`, `getHostByName`
- Boolean predicates: `is*` / `has*` — `isAdmin`, `isMailingList`, `isPinned`, `hasListUnsubscribe`

**Variables:**
- Local `camelCase`. Module-level constants `UPPER_SNAKE_CASE` — `HAIKU_MODEL`, `IMPORTANT_CLASSIFIER_VERSION`, `PROD_HOST_PATTERNS`, `SUMMARY_MAX`, `MAX_OUTPUT_TOKENS`, `RUN_PREFIX`

**Types:**
- `PascalCase`. `interface` for component prop bags / data shapes, `type` for unions, intersections, discriminated results
  - Interfaces: `ReplyCardProps`, `LlmImportantInput`, `LlmImportantClassification`
  - Type unions: `ActionResult`, `ImportantOutcome`, `ActionErrorCode`, `StateFilter`
- Zod schema constants follow the type they produce: `ActionInput` (schema) + `ActionInputT = z.infer<typeof ActionInput>`
- Avoid `any`. Use `unknown` at boundaries (LLM output, container inspect JSON, `rawInput: unknown` for Server Actions) and narrow with Zod / `instanceof`

## Code Style

**Language:** TypeScript with `"strict": true` in `tsconfig.json`. Target ES2020, module `esnext`, `moduleResolution: "bundler"`, `isolatedModules: true`. ESM throughout (no CommonJS in `src/`).

**Formatting (Prettier — `.prettierrc.json`):**
- `semi: true`
- `singleQuote: false` (double quotes)
- `trailingComma: "all"`
- `tabWidth: 2`
- `printWidth: 80`
- Plugin: `prettier-plugin-tailwindcss` (auto-sorts Tailwind class lists)
- Run: `pnpm format` (writes `src/**/*.{ts,tsx,css,md}`)

**Linting (`eslint.config.mjs`):**
- Extends `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`
- `eslint-plugin-boundaries` enforces FSD layer direction (see "FSD Barrel Rule" below)
- Run: `pnpm lint`

**Type Checking:**
- `pnpm typecheck` → `tsc --noEmit`

## Import Organization

Observed order in production modules (`src/features/container-actions/api/_runAction.ts`, `src/entities/email/api/classifyImportant.ts`, `src/shared/lib/llm/classify-important.ts`):

1. **Side-effect imports** (must come first to assert runtime contract)
   - `import "server-only";` — server-only module guard
   - `import "dotenv/config";` — only in test setup / scripts
2. **Third-party packages** — `zod`, `drizzle-orm`, `next/cache`, `@anthropic-ai/sdk`, `vitest`
3. **`@/...` alias imports** (FSD respecting layer direction)
4. **Relative imports** — `./isAdmin`, `../lib/unsubscribe-filter`
5. **Type-only imports** (`import type { ... }`) grouped near related runtime imports

**Path Aliases:**
- `@/*` → `src/*` (declared in `tsconfig.json` `paths`; mirrored in `vitest.config.ts` `resolve.alias`)
- Use `@/shared/...`, `@/entities/...`, `@/features/...`, `@/widgets/...` — never `../../../src/...`

## FSD Barrel Rule (CRITICAL)

Each slice exposes a `index.ts` (Public API). External consumers must import from the slice root.

```typescript
// CORRECT — slice barrel
import { getImportantEmails } from "@/entities/email";

// WRONG — deep path from outside the slice
import { getImportantEmails } from "@/entities/email/api/getImportantEmails";
```

**Allowed direction (enforced by `eslint-plugin-boundaries`):**
- `app → widgets → features → entities → shared`
- `features → features` is the only intentional same-layer exception (e.g. `host-catalog` reuses `container-list/lib/groupByProject`); `entities → entities` is forbidden.

**Client-tree exception (Gotcha #1 in `CLAUDE.md`):**
- Inside `"use client"` components, do NOT import from `@/entities/*` or `@/features/*` barrels. The barrels re-export server-only modules (`listContainers` → `node:child_process`) and Turbopack pulls the whole barrel into the client bundle even for `import type`.
- Use deep paths from client trees:

```typescript
// Inside a "use client" component
import { ProjectGroupSection } from "@/features/container-list/ui/ProjectGroupSection";
import type { ContainerSummary } from "@/entities/container/model/types";
```

## React Conventions

**RSC default, `"use client"` minimal:**
- Server Components by default. Only 7 files in `src/` use `"use client"` (host-dashboard widget, reply/push UI, action buttons, important-email row, error states).
- Server modules carry `import "server-only";` at the top — currently in `src/shared/api/gmail/*`, `src/shared/config/env.ts`, `src/shared/lib/auth/*`, `src/shared/lib/push/*`, `src/shared/lib/llm/*`, `src/shared/lib/docker/*`, `src/features/container-actions/api/_runAction.ts`.

**Server Actions:**
- Top of file: `"use server";`
- Thin entry that delegates to a shared internal: see `src/features/container-actions/api/restartContainer.ts` → `_runAction.ts`
- Take `rawInput: unknown` and validate via Zod `safeParse` at the boundary (never trust client input)

**Props:**
- Named `interface XxxProps` co-located with the component
- Avoid `React.FC`; destructure props in the parameter list

**Hooks:**
- Client-only state via `useState` / `useTransition` (see `ReplyCard.tsx`)
- Shared client state in `zustand` stores (kept under `shared/` or per-feature `model/`)
- Server state via TanStack Query when needed; do not duplicate server state into client stores

## Styling

**Tailwind CSS v4** (no `tailwind.config.js` — config lives in CSS).

**Design tokens — `src/app/globals.css`:**
- Defines `:root` CSS custom properties for color (oklch), spacing (4px scale), radius, typography, fonts, shadows, motion
- Tokens mirror `src/shared/config/tokens.ts` (manual sync; build-time mirror deferred to v0.2)
- Tailwind theme mapped via `@theme inline { --color-...: var(--color-...); }`
- Korean-friendly font stack: Pretendard / IBM Plex Sans KR
- Accessibility: `@media (prefers-reduced-motion: reduce)` zeroes animations

**Light-mode forced (CRITICAL):**
- `:root { color-scheme: light; }`
- Dark variant **disabled at the source**:
  ```css
  @variant dark (&:where(.dark, .dark *));
  ```
  This redefines `dark:*` utilities to fire only when a `.dark` class is on an ancestor (we never set it), neutralising the default `prefers-color-scheme: dark` behaviour that broke our light-only palette.
- Consequence: stray `dark:bg-...` / `dark:text-...` classes are dead code and should be removed when touching a file.

**Class order:** Prettier + `prettier-plugin-tailwindcss` sorts automatically.

## Error Handling

**Strategy:** Discriminated-union results at trust boundaries; throw only for programmer errors and unrecoverable infrastructure faults.

**Server Action pattern (`src/features/container-actions/api/_runAction.ts`):**
```typescript
export type ActionResult =
  | { ok: true }
  | { ok: false; code: ActionErrorCode; message?: string };
```
- Five sequential gates (Authentication → Authorization → Input validation → Resource lookup → Action) — each gate returns an `{ ok: false, code }` early without throwing
- `try`/`catch` around the side-effect (`runDocker`), capture error in a local, then write an audit row with `status: "success" | "failed"`
- `errorMessage` truncated to 500 chars to bound DB row size and avoid leaking docker stderr

**LLM outcomes (`src/entities/email/api/classifyImportant.ts`):**
```typescript
export type ImportantOutcome =
  | { kind: "classified"; category: Category; importance: ImportantImportance }
  | { kind: "skipped-mailing-list" }
  | { kind: "skipped-already" }
  | { kind: "skipped-none" }
  | { kind: "skipped-llm-error" };
```
- Caller (`syncInbox`) inspects `outcome.kind`; one bad thread never aborts the cron sweep

**LLM SDK errors:**
- Inside `classifyImportantWithLlm` API failures throw — the outer orchestrator catches and converts to `skipped-llm-error`
- Schema-violation responses log a structured warn and return `null` (not thrown)

**Audit-log isolation:**
- Audit insert failures are caught independently (`try` around `insertAuditLog`) so they cannot mask the underlying Docker result

## Validation (Zod at the Boundary)

- All external input passes through Zod: Server Action input, LLM responses, environment variables, parsed docker JSON
- Pattern: define schema, derive type with `z.infer`, call `safeParse`, branch on `parsed.success`
- Example — Server Action input:
  ```typescript
  export const ActionInput = z.object({
    hostId: z.string().uuid(),
    containerId: z.string().regex(/^[a-f0-9]{12,64}$/), // hex only — path traversal defence
    containerName: z.string().min(1).max(200),
  });
  export type ActionInputT = z.infer<typeof ActionInput>;
  ```
- Example — LLM response:
  ```typescript
  const ResponseSchema = z.object({
    category: z.enum(["money", "security", "schedule", "notice", "none"]),
    importance: z.enum(["high", "med"]),
    summary: z.string().max(SUMMARY_MAX),
    rationale: z.string().max(200),
  });
  ```

## Environment Variable Validation

**File:** `src/shared/config/env.ts`

- Carries `import "server-only";` — never bundled to the client
- Single Zod schema parses `process.env` at module-load time
- Failure prints `parsed.error.flatten().fieldErrors` then throws — Next.js boot dies loudly rather than running with a missing secret
- Exports `env: typeof parsed.data` and `type Env = typeof env` — consumers `import { env } from "@/shared/config/env";` instead of touching `process.env` directly
- Coerced numerics: `DOCKER_CMD_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000)`
- Constraints encode policy: `NEXTAUTH_SECRET: z.string().min(32, "openssl rand -base64 32 로 생성")`, `TZ: z.literal("Asia/Seoul")`

## Immutability

- Never mutate function inputs. Build new objects/arrays via spread.
- DB writes go through Drizzle insert/update + `returning()` — return the fresh row rather than mutating
- React state setters always receive new objects (`setError(message)`, `setIsHidden(true)`) — never `state.field = ...`

## Comments (Korean Policy)

- **Comments are written in Korean** (per global `~/.claude/rules/korean-response.md`)
- **Code identifiers stay English** — variable names, function names, types, file names
- Top-of-file comments describe purpose, invariants, and gotchas — see `_runAction.ts` ("보안 boundary 5종"), `tests/setup.ts` ("CRITICAL — prod DB 가드"), `globals.css` (dark variant rationale)
- Inline comments explain *why*, not *what*. Frequent pattern: anti-pattern call-out + intentional design decision

## Forbidden / "Console.log" Policy

- Production code avoids `console.log`. `console.warn` / `console.error` are acceptable for diagnostic paths that have no structured logger yet — guarded by a `TODO(logger)` marker when introduced (see `classify-important.ts`).
- No raw secrets in logs. The Docker layer (`maskEnv`) masks env var values matching sensitive key patterns before they ever reach the inspect UI or logs.

## Commit Convention

Format (from `~/.claude/rules/korean-response.md` and observed in `git log`):

```
<type>(<scope>): <한국어 제목>

<한국어 본문 — 변경 이유·영향 (선택)>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Types (English, lowercase):** `feat`, `fix`, `docs`, `refactor`, `style`, `test`, `chore`, `perf`, `ci`

**Title rules:**
- Korean, command form ("추가", "수정", "삭제")
- ≤ 50 chars, no trailing period
- Scope in parens: `feat(servers):`, `fix(scripts):`, `docs(claude-md):`

**Body rules:**
- Korean, bulleted, wraps at ~72 chars
- Explain *why* and impact, not just *what*

**Co-author trailer:** Always include the Claude trailer line when an AI assistant wrote or co-authored the change.

Recent examples (`git log --oneline -5`):
- `docs(claude-md): 로컬 테스트 DB 명령·TODOS 색인 추가 + 응답 규칙 축약`
- `feat(servers): 호스트 상세 화이트 톤 + 검색/필터/단축키/도움말 (#11)`
- `feat(email-digest): '답장하기' 버튼 추가 + '답장함' 레이블 명확화 (#10)`
- `fix(scripts): cleanup-projects가 running 컨테이너만 'live'로 인정 (#9)`

## Module Design

**Exports:**
- Named exports only (no `default` in slice barrels)
- Barrel re-exports the slice's runtime API + companion `export type { ... }` for shapes
- Internal helpers (folder-scoped) use `_` prefix and are NOT re-exported from `index.ts` — e.g. `_runAction.ts`

**Public/private boundary inside a slice:**
- `ui/`, `model/`, `api/`, `lib/` subfolders
- Anything cross-slice consumers should reach lives in `index.ts`; everything else is implementation detail

## Function Design

- Functions stay ≤ ~50 lines; split when boundaries (gates, parse + map + validate) become numerous
- Early returns over nested conditionals (Server Action gates use this throughout)
- Return discriminated unions instead of multiple optional fields
- Public functions carry explicit return types; locals rely on inference

---

*Convention analysis: 2026-05-11*
