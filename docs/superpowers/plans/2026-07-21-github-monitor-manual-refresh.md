# GitHub 관제 수동 새로고침 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/monitoring/github` 페이지에 즉시 재수집 버튼을 추가해, cron(5분)을 기다리지 않고 GitHub 에서 최신 이슈·PR·Actions 를 바로 가져와 화면에 반영한다.

**Architecture:** 새 feature `github-monitor-refresh` 를 만든다. `client.ts` 자체가 `"use server"` Server Action 이며(`catalog-refresh` 패턴) `github-monitor` 의 server-only `syncGithub()` 를 호출한다. rate limit 은 순수 함수로 분리해 테스트한다. client 버튼은 `useTransition` + `router.refresh()` 로 화면을 갱신한다.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), TypeScript strict, React `useTransition`, Vitest.

## Global Constraints

- **관련 이슈**: #333 (spec: `docs/superpowers/specs/2026-07-21-github-monitor-manual-refresh-design.md`). 커밋 메시지·PR 에 `#333` 참조.
- **server/client seam (Gotcha #7)**: `syncGithub()` 은 `import "server-only"`. client 트리는 반드시 `"use server"` 파일(`client.ts`)을 통해서만 호출한다. server-only 함수를 client 가 직접 import 하는 barrel 을 만들지 않는다.
- **검증**: `cd apps/dashboard && pnpm build` 는 이 seam 위반을 잡는 유일한 게이트다 — typecheck/lint 로는 안 잡힌다. plan 완료 시 필수.
- **vitest include**: `src/**/*.test.ts` 가 포함되어 feature 내 테스트가 잡힌다. 단, 새 테스트는 **단일 경로로 실행해 "1 passed" 를 눈으로 확인**한다 (include 밖이면 조용히 skip).
- **테스트 DB 가드**: 순수 함수·mock 기반 테스트만 작성하므로 DB 불필요. `TEST_DATABASE_URL` 없이 실행 가능.
- **rate limit**: 전역(사용자 무관) in-memory 쿨다운 **30초**. GitHub API 는 토큰 단위 공유 자원이라 사용자별이 아니라 전역.
- **접근 통제**: 로그인한 모든 사용자. 액션은 `auth()` 로 `session.user.id` 존재만 확인.

---

## File Structure

```
features/github-monitor-refresh/
├── model/types.ts          # RefreshResult 타입 (client·server 공유)
├── lib/rateLimit.ts        # checkCooldown 순수 함수 (테스트 대상)
├── lib/rateLimit.test.ts   # 쿨다운 순수 함수 단위 테스트
├── client.ts               # "use server" — auth + rate limit + syncGithub() (Server Action)
├── client.test.ts          # Server Action 단위 테스트 (auth·syncGithub mock)
└── ui/RefreshButton.tsx    # "use client" — useTransition + router.refresh()
```

`app/(dashboard)/monitoring/github/page.tsx` 를 수정해 `PageHeader` 의 `actions` slot 에 `<RefreshButton />` 을 주입한다.

**왜 `client.ts` 가 곧 Server Action 인가**: `catalog-refresh/client.ts` 가 확립한 패턴이다. `"use server"` 파일 전체가 RPC 경계라, 그 안에서 server-only `syncGithub()` 를 import 해도 client bundle 그래프로 끌려오지 않는다. 별도 `api/*.ts` + 재-export 를 두지 않고 `client.ts` 하나로 끝낸다.

---

### Task 1: RefreshResult 타입 + 쿨다운 순수 함수

**Files:**
- Create: `apps/dashboard/src/features/github-monitor-refresh/model/types.ts`
- Create: `apps/dashboard/src/features/github-monitor-refresh/lib/rateLimit.ts`
- Test: `apps/dashboard/src/features/github-monitor-refresh/lib/rateLimit.test.ts`

**Interfaces:**
- Produces:
  - `interface RefreshResult { ok: boolean; error?: string; summary?: RefreshSummary; cooldownSec?: number }`
  - `interface RefreshSummary { issues: number; pulls: number; runs: number; skipped: boolean; lockBusy: boolean }`
  - `checkCooldown(lastAt: number | null, now: number, windowMs: number): { allowed: boolean; remainingSec: number }`

- [ ] **Step 1: 타입 파일 작성**

Create `apps/dashboard/src/features/github-monitor-refresh/model/types.ts`:

```typescript
// 수동 새로고침 결과 — client·server 공유 (이슈 #333).

/** syncGithub 결과 요약 — 버튼 피드백용. */
export interface RefreshSummary {
  issues: number;
  pulls: number;
  runs: number; // 성공 레포 수
  skipped: boolean; // 토큰 미설정
  lockBusy: boolean; // cron 과 겹쳐 이번 실행은 건너뜀
}

export interface RefreshResult {
  ok: boolean;
  error?: string;
  summary?: RefreshSummary;
  cooldownSec?: number; // rate limit 걸렸을 때 남은 초
}
```

- [ ] **Step 2: 쿨다운 순수 함수 테스트 작성 (실패 예상)**

Create `apps/dashboard/src/features/github-monitor-refresh/lib/rateLimit.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { checkCooldown } from "./rateLimit";

const WINDOW = 30_000;

describe("checkCooldown", () => {
  it("최초 호출(lastAt=null)은 허용", () => {
    expect(checkCooldown(null, 1_000, WINDOW)).toEqual({
      allowed: true,
      remainingSec: 0,
    });
  });

  it("윈도우 내 재호출은 거부하고 남은 초를 올림한다", () => {
    // 마지막 호출 1000ms, 현재 6000ms → 5초 경과, 25초 남음
    expect(checkCooldown(1_000, 6_000, WINDOW)).toEqual({
      allowed: false,
      remainingSec: 25,
    });
  });

  it("윈도우 경계(정확히 30초)는 허용", () => {
    expect(checkCooldown(1_000, 31_000, WINDOW)).toEqual({
      allowed: true,
      remainingSec: 0,
    });
  });

  it("남은 초는 올림 처리 — 24.1초 남으면 25 반환", () => {
    // 마지막 1000, 현재 6900 → 5.9초 경과, 24.1초 남음 → ceil = 25
    expect(checkCooldown(1_000, 6_900, WINDOW)).toEqual({
      allowed: false,
      remainingSec: 25,
    });
  });
});
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/github-monitor-refresh/lib/rateLimit.test.ts`
Expected: FAIL — `checkCooldown` 이 없어 import 에러.

- [ ] **Step 4: 쿨다운 순수 함수 구현**

Create `apps/dashboard/src/features/github-monitor-refresh/lib/rateLimit.ts`:

```typescript
// 전역 쿨다운 판정 — 순수 함수. 시간 상태는 호출 측이 주입한다(테스트 가능).

export interface CooldownCheck {
  allowed: boolean;
  remainingSec: number;
}

/**
 * lastAt(마지막 허용 시각, ms) 로부터 windowMs 가 지났는지 판정한다.
 * lastAt 이 null 이면 최초 호출 — 항상 허용.
 */
export function checkCooldown(
  lastAt: number | null,
  now: number,
  windowMs: number,
): CooldownCheck {
  if (lastAt === null) return { allowed: true, remainingSec: 0 };
  const elapsed = now - lastAt;
  if (elapsed >= windowMs) return { allowed: true, remainingSec: 0 };
  return { allowed: false, remainingSec: Math.ceil((windowMs - elapsed) / 1000) };
}
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/github-monitor-refresh/lib/rateLimit.test.ts`
Expected: PASS — `Test Files 1 passed`, `Tests 4 passed`. "1 passed" 를 눈으로 확인(include 밖이면 "no test files").

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/features/github-monitor-refresh/model/types.ts \
        apps/dashboard/src/features/github-monitor-refresh/lib/rateLimit.ts \
        apps/dashboard/src/features/github-monitor-refresh/lib/rateLimit.test.ts
git commit -m "feat(monitoring): 수동 새로고침 타입·쿨다운 순수 함수 (#333)"
```

---

### Task 2: Server Action (`client.ts`)

**Files:**
- Create: `apps/dashboard/src/features/github-monitor-refresh/client.ts`
- Test: `apps/dashboard/src/features/github-monitor-refresh/client.test.ts`

**Interfaces:**
- Consumes:
  - `RefreshResult`, `RefreshSummary` (Task 1)
  - `checkCooldown` (Task 1)
  - `syncGithub(): Promise<SyncSummary>` from `@/features/github-monitor` — `SyncSummary` 형태(index.ts 참조):
    `{ skipped: boolean; lockBusy?: boolean; issues: { ok; count }; pulls: { ok; count }; runs: { ok; repos; failedRepos }; build: {...} }`
  - `auth()` from `@/shared/lib/auth` — `Promise<{ user?: { id?: string } } | null>`
- Produces:
  - `refreshGithubMonitor(): Promise<RefreshResult>` — `"use server"` Server Action.

- [ ] **Step 1: Server Action 테스트 작성 (실패 예상)**

> **환경 주의**: 이 테스트는 전역 `node` 환경에서 돈다(DOM 불필요). `@/shared/lib/auth`
> 와 `@/features/github-monitor` 를 완전히 mock 하므로 실제 DB·GitHub·env 검증 경로를
> 타지 않는다 — `tests/setup.ts` 의 prod DB 가드와 무관하게 통과한다. mock 경로 문자열
> (`@/features/github-monitor`, `@/shared/lib/auth`)은 실제 import 경로와 정확히
> 일치해야 mock 이 적용된다.

Create `apps/dashboard/src/features/github-monitor-refresh/client.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth·syncGithub 를 mock — 실제 DB·GitHub 호출 없이 액션 로직만 검증.
const authMock = vi.fn();
const syncGithubMock = vi.fn();

vi.mock("@/shared/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/features/github-monitor", () => ({
  syncGithub: () => syncGithubMock(),
}));

// mock 을 건 뒤 import (동적 import 로 mock 선적용 보장).
async function loadAction() {
  const mod = await import("./client");
  return mod.refreshGithubMonitor;
}

const okSummary = {
  skipped: false,
  lockBusy: false,
  issues: { ok: true, count: 12 },
  pulls: { ok: true, count: 3 },
  runs: { ok: true, repos: 5, failedRepos: [] },
  build: { ok: true, state: "synced" },
};

beforeEach(() => {
  vi.resetModules(); // 모듈 내 in-memory 쿨다운 상태를 매 테스트 초기화
  authMock.mockReset();
  syncGithubMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshGithubMonitor", () => {
  it("미인증이면 Unauthorized 로 거부하고 syncGithub 을 부르지 않는다", async () => {
    authMock.mockResolvedValue(null);
    const refresh = await loadAction();

    const r = await refresh();

    expect(r).toEqual({ ok: false, error: "Unauthorized" });
    expect(syncGithubMock).not.toHaveBeenCalled();
  });

  it("정상 실행 시 summary 를 매핑해 반환한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockResolvedValue(okSummary);
    const refresh = await loadAction();

    const r = await refresh();

    expect(r.ok).toBe(true);
    expect(r.summary).toEqual({
      issues: 12,
      pulls: 3,
      runs: 5,
      skipped: false,
      lockBusy: false,
    });
  });

  it("lockBusy(cron 겹침)를 summary 에 표시한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockResolvedValue({
      ...okSummary,
      skipped: true,
      lockBusy: true,
      issues: { ok: false, count: 0 },
      pulls: { ok: false, count: 0 },
      runs: { ok: false, repos: 0, failedRepos: [] },
    });
    const refresh = await loadAction();

    const r = await refresh();

    expect(r.ok).toBe(true);
    expect(r.summary?.lockBusy).toBe(true);
  });

  it("두 번째 호출은 쿨다운으로 거부한다 (cooldownSec 포함)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockResolvedValue(okSummary);
    const refresh = await loadAction();

    const first = await refresh();
    expect(first.ok).toBe(true);

    vi.setSystemTime(5_000); // 5초 뒤 재호출
    const second = await refresh();

    expect(second.ok).toBe(false);
    expect(second.cooldownSec).toBe(25);
    expect(syncGithubMock).toHaveBeenCalledTimes(1); // 두 번째는 syncGithub 미호출
  });

  it("syncGithub 이 throw 하면 ok:false 로 흡수한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockRejectedValue(new Error("boom"));
    const refresh = await loadAction();

    const r = await refresh();

    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/github-monitor-refresh/client.test.ts`
Expected: FAIL — `./client` 모듈 없음.

- [ ] **Step 3: Server Action 구현**

Create `apps/dashboard/src/features/github-monitor-refresh/client.ts`:

```typescript
// github-monitor-refresh feature — client-safe entrypoint (이슈 #333).
// "use server" 파일 전체가 RPC 경계라, 여기서 server-only syncGithub 을
// import 해도 client bundle 그래프로 끌려오지 않는다 (Gotcha #7 패턴,
// catalog-refresh/client.ts 준용). "use client" 컴포넌트는 이 파일로만 호출한다.
"use server";

import { auth } from "@/shared/lib/auth";
import { logger } from "@/shared/lib/log";
import { syncGithub } from "@/features/github-monitor";
import { checkCooldown } from "./lib/rateLimit";
import type { RefreshResult } from "./model/types";

const COOLDOWN_MS = 30_000;

// 전역(사용자 무관) 쿨다운. GitHub API 는 토큰 단위 공유 자원이라 전역이 맞다.
// 단일 인스턴스 가정 — multi-instance 시 Redis 로 이전 필요.
let lastRefreshAt: number | null = null;

export async function refreshGithubMonitor(): Promise<RefreshResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const now = Date.now();
  const cd = checkCooldown(lastRefreshAt, now, COOLDOWN_MS);
  if (!cd.allowed) {
    return {
      ok: false,
      error: `잠시 후 다시 시도하세요 (${cd.remainingSec}초 남음)`,
      cooldownSec: cd.remainingSec,
    };
  }
  lastRefreshAt = now;

  try {
    const s = await syncGithub();
    return {
      ok: true,
      summary: {
        issues: s.issues.count,
        pulls: s.pulls.count,
        runs: s.runs.repos,
        skipped: s.skipped,
        lockBusy: s.lockBusy ?? false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("github-monitor-refresh", "sync-failed", { message });
    return { ok: false, error: message.slice(0, 200) };
  }
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/github-monitor-refresh/client.test.ts`
Expected: PASS — `Test Files 1 passed`, `Tests 5 passed`.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/github-monitor-refresh/client.ts \
        apps/dashboard/src/features/github-monitor-refresh/client.test.ts
git commit -m "feat(monitoring): 수동 새로고침 Server Action — auth·쿨다운·syncGithub (#333)"
```

---

### Task 3: RefreshButton client 컴포넌트

**Files:**
- Create: `apps/dashboard/src/features/github-monitor-refresh/ui/RefreshButton.tsx`
- Test: `apps/dashboard/src/features/github-monitor-refresh/ui/RefreshButton.test.tsx`

**Interfaces:**
- Consumes:
  - `refreshGithubMonitor` (Task 2)
  - `RefreshResult`, `RefreshSummary` (Task 1)
  - `useRouter().refresh()` from `next/navigation`
- Produces:
  - `RefreshButton()` — export 되는 `"use client"` 컴포넌트 (props 없음).

- [ ] **Step 1: 컴포넌트 테스트 작성 (실패 예상)**

Create `apps/dashboard/src/features/github-monitor-refresh/ui/RefreshButton.test.tsx`:

> **환경 주의**: vitest 전역 환경이 `node` 다. 컴포넌트 테스트는 파일 최상단에
> `// @vitest-environment jsdom` 주석으로 jsdom 을 켠다(프로젝트 관용,
> `CatalogRefreshButton.test.tsx` 준용). `@testing-library/user-event` 는 미설치라
> `@testing-library/react` 의 `fireEvent` 를 쓴다.

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("../client", () => ({
  refreshGithubMonitor: () => refreshMock(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { RefreshButton } from "./RefreshButton";

beforeEach(() => {
  refreshMock.mockReset();
  routerRefreshMock.mockReset();
});

afterEach(cleanup);

describe("RefreshButton", () => {
  it("클릭 시 refreshGithubMonitor 를 호출하고 성공하면 router.refresh 한다", async () => {
    refreshMock.mockResolvedValue({
      ok: true,
      summary: { issues: 12, pulls: 3, runs: 5, skipped: false, lockBusy: false },
    });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침/ }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/갱신 완료/)).toBeTruthy();
  });

  it("쿨다운 거부 시 에러 메시지를 표시하고 router.refresh 하지 않는다", async () => {
    refreshMock.mockResolvedValue({
      ok: false,
      error: "잠시 후 다시 시도하세요 (25초 남음)",
      cooldownSec: 25,
    });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: /새로고침/ }));

    expect(await screen.findByText(/25초 남음/)).toBeTruthy();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/github-monitor-refresh/ui/RefreshButton.test.tsx`
Expected: FAIL — `./RefreshButton` 모듈 없음.

- [ ] **Step 3: 컴포넌트 구현**

Create `apps/dashboard/src/features/github-monitor-refresh/ui/RefreshButton.tsx`:

```tsx
// GitHub 관제 수동 새로고침 버튼 (이슈 #333).
// 클릭 시 refreshGithubMonitor Server Action 을 호출해 즉시 재수집하고,
// 성공하면 router.refresh() 로 RSC 를 재요청해 방금 갱신된 스냅샷을 표시한다.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { refreshGithubMonitor } from "../client";
import type { RefreshResult } from "../model/types";

/** ok 결과를 사람이 읽을 피드백 문구로. */
function successLabel(result: RefreshResult): string {
  const s = result.summary;
  if (!s) return "갱신 완료";
  if (s.skipped && s.lockBusy) return "동기화 진행 중 — 곧 반영됩니다";
  if (s.skipped) return "토큰 미설정 — 동기화 비활성";
  return `갱신 완료 · 이슈 ${s.issues} · PR ${s.pulls} · 레포 ${s.runs}`;
}

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await refreshGithubMonitor();
      setResult(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-50"
      >
        {isPending ? "새로고침 중…" : "새로고침"}
      </button>
      {result?.ok && (
        <p className="max-w-xs text-right text-xs text-[var(--color-text-muted)]">
          {successLabel(result)}
        </p>
      )}
      {result && !result.ok && (
        <p className="max-w-xs text-right text-xs text-[var(--color-severity-high)]">
          {result.error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/github-monitor-refresh/ui/RefreshButton.test.tsx`
Expected: PASS — `Test Files 1 passed`, `Tests 2 passed`.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/github-monitor-refresh/ui/RefreshButton.tsx \
        apps/dashboard/src/features/github-monitor-refresh/ui/RefreshButton.test.tsx
git commit -m "feat(monitoring): 수동 새로고침 버튼 UI — useTransition·피드백 (#333)"
```

---

### Task 4: 페이지 통합 + 빌드 검증

**Files:**
- Modify: `apps/dashboard/src/app/(dashboard)/monitoring/github/page.tsx:83` (PageHeader)

**Interfaces:**
- Consumes: `RefreshButton` (Task 3)

- [ ] **Step 1: page.tsx 에 RefreshButton 통합**

`apps/dashboard/src/app/(dashboard)/monitoring/github/page.tsx` 상단 import 블록에 추가(다른 widgets import 근처):

```typescript
import { RefreshButton } from "@/features/github-monitor-refresh/ui/RefreshButton";
```

그리고 `PageHeader` 를 `actions` slot 을 쓰도록 수정한다. 현재(83행 부근):

```tsx
      <PageHeader title="GitHub 관제" subtitle={`${org} 의 이슈·PR·Actions 현황`} />
      <AutoRefresh intervalMs={15_000} />
```

변경 후:

```tsx
      <PageHeader
        title="GitHub 관제"
        subtitle={`${org} 의 이슈·PR·Actions 현황`}
        actions={<RefreshButton />}
      />
      <AutoRefresh intervalMs={15_000} />
```

> 참고: `RefreshButton` 은 `@/features/github-monitor-refresh/ui/RefreshButton` 깊은 경로로 import 한다. feature 에 client barrel 이 없고(client.ts 는 Server Action 전용), `"use client"` 컴포넌트를 server-only 의존과 섞지 않기 위함이다.

- [ ] **Step 2: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 없음. (FSD boundary: `app → features` 는 허용 방향이라 통과)

- [ ] **Step 3: 전체 feature 테스트 재실행**

Run: `cd apps/dashboard && pnpm vitest run src/features/github-monitor-refresh`
Expected: 3개 테스트 파일 전부 PASS (`Test Files 3 passed`).

- [ ] **Step 4: 프로덕션 빌드 검증 (seam 게이트)**

Run: `cd apps/dashboard && pnpm build`
Expected: 빌드 성공. `Module not found: Can't resolve 'tls'/'net'/'perf_hooks'` 류 에러가 없어야 한다 — 있으면 server/client seam 위반(Gotcha #7)이므로 Task 2 의 seam 구조를 재점검한다.

- [ ] **Step 5: 커밋**

```bash
git add "apps/dashboard/src/app/(dashboard)/monitoring/github/page.tsx"
git commit -m "feat(monitoring): GitHub 관제 페이지에 수동 새로고침 버튼 배치 (#333)"
```

---

## Self-Review 결과

**Spec coverage** — spec 각 요구사항 대응:
- 즉시 재수집 동작 → Task 2 (`syncGithub()` 호출) + Task 3 (`router.refresh()`). ✓
- 접근: 로그인 사용자 → Task 2 Step 3 (`auth()` 확인). ✓
- 전역 30초 쿨다운 → Task 1 (`checkCooldown`) + Task 2 (전역 `lastRefreshAt`). ✓
- lockBusy/skipped/쿨다운/에러 구분 피드백 → Task 2 (summary 매핑) + Task 3 (`successLabel`·에러 분기). ✓
- server/client seam 분리 → Task 2 (`client.ts` = `"use server"`) + Task 4 Step 4 (build 게이트). ✓
- 단위 테스트 4종 → Task 2 Step 1 (미인증/정상/lockBusy/쿨다운/throw). ✓
- `pnpm build` 통과 → Task 4 Step 4. ✓
- `PageHeader.actions` 배치 → Task 4 Step 1. ✓

**Placeholder scan** — TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 완전한 코드 포함. ✓

**Type consistency** — `RefreshResult`/`RefreshSummary` 필드명(`issues`/`pulls`/`runs`/`skipped`/`lockBusy`)이 Task 1 정의 → Task 2 매핑 → Task 3 소비까지 일관. `checkCooldown` 시그니처(`lastAt`,`now`,`windowMs` → `{allowed,remainingSec}`)가 Task 1 정의 → Task 2 호출 일관. `syncGithub` 반환 필드(`issues.count`,`pulls.count`,`runs.repos`,`skipped`,`lockBusy`)가 `github-monitor/index.ts` 의 `SyncSummary` 와 일치. ✓
