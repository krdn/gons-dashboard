# 카탈로그 새로고침 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/skills`·`/plugins`·`/agents` 페이지에 로컬 개발 전용 카탈로그 재생성 버튼을 추가한다.

**Architecture:** Server Action 이 기존 `pnpm {skills,plugins,agents}:snapshot` 명령을 `child_process.spawn` 으로 실행한다(직접 import 는 `import.meta.url` 경로 해석·번들 경계 함정 때문에 기각). FSD 의 server/client seam 패턴(Gotcha #7)으로 `features/catalog-refresh` 를 구성 — server-only spawn 로직은 `index.ts`, `"use server"` Server Action 은 `client.ts`, 버튼은 client 컴포넌트.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, React 19 (`useTransition`), Vitest + jsdom, `node:child_process`.

## Global Constraints

- **dev 전용**: 버튼은 `process.env.NODE_ENV !== "production"` 일 때만 렌더. Server Action 은 `NODE_ENV === "production"` 이면 거부(2차 방어). 운영 컨테이너엔 소스 `~/.claude` 가 없다.
- **FSD 의존성**: `"use client"` 컴포넌트는 `@/features/catalog-refresh/client` 로만 import (server-only 가 client bundle 그래프로 끌려가는 것 방지 — Gotcha #7).
- **spawn cwd 명시**: `process.cwd()` 에 의존하지 말고 repo root 를 결정론적으로 계산해 `cwd` 로 전달.
- **한국어 UI 문구**, 코드·식별자는 영어 (`~/.claude/rules/korean-response.md`).
- **검증**: PR 전 `pnpm typecheck && pnpm lint` 필수. Gotcha #7 관련 변경이므로 `cd apps/dashboard && pnpm build` 도 1회 실행.
- **테스트 실행**: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test <경로>` (DB 미의존 순수 테스트라 ECONNREFUSED 무관하지만 setup 가드 통과 위해 env 필요).

---

## File Structure

```
apps/dashboard/src/features/catalog-refresh/
├── index.ts                       # server entrypoint: spawnSnapshot(kind) + SNAPSHOT_SCRIPTS 매핑
├── client.ts                      # "use server" Server Action: refreshCatalog(kind)
├── model/
│   └── types.ts                   # CatalogKind, RefreshResult, parseSnapshotCount
├── lib/
│   └── parseSnapshotCount.ts      # stdout → count 파싱 (순수 함수, 단위 테스트 대상)
└── ui/
    └── CatalogRefreshButton.tsx   # "use client" 버튼 + 상태/경고 UI

apps/dashboard/src/features/catalog-refresh/lib/parseSnapshotCount.test.ts   # 파싱 단위 테스트
apps/dashboard/src/features/catalog-refresh/ui/CatalogRefreshButton.test.tsx # 버튼 컴포넌트 테스트
```

수정 대상 (버튼 배치):
- `apps/dashboard/src/app/(dashboard)/skills/page.tsx`
- `apps/dashboard/src/app/(dashboard)/plugins/page.tsx`
- `apps/dashboard/src/app/(dashboard)/agents/page.tsx`

---

## Task 1: 타입 + stdout 파싱 순수 함수

feature 의 기반 타입과, spawn stdout 에서 개수를 뽑는 순수 함수. 순수 함수라 DB·spawn 없이 단위 테스트 가능.

**Files:**
- Create: `apps/dashboard/src/features/catalog-refresh/model/types.ts`
- Create: `apps/dashboard/src/features/catalog-refresh/lib/parseSnapshotCount.ts`
- Test: `apps/dashboard/src/features/catalog-refresh/lib/parseSnapshotCount.test.ts`

**Interfaces:**
- Produces:
  - `type CatalogKind = "skills" | "plugins" | "agents"`
  - `type RefreshResult = { ok: true; count?: number; warning: string } | { ok: false; error: string }`
  - `function parseSnapshotCount(stdout: string): number | undefined`

- [ ] **Step 1: 파싱 함수의 실패 테스트 작성**

`apps/dashboard/src/features/catalog-refresh/lib/parseSnapshotCount.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseSnapshotCount } from "./parseSnapshotCount";

describe("parseSnapshotCount", () => {
  it("skills 스냅샷 stdout 에서 개수를 파싱한다", () => {
    const out = "[snapshot-skills] ✅ 생성 38개 / skip 2개 / 한글 overlay 36개";
    expect(parseSnapshotCount(out)).toBe(38);
  });

  it("plugins 스냅샷 stdout 에서 개수를 파싱한다", () => {
    const out =
      "[snapshot-plugins] ✅ 생성 12개 / 활성 8 / 휴면 4 / 경로없음 0 / 한글 overlay 5";
    expect(parseSnapshotCount(out)).toBe(12);
  });

  it("여러 줄 stdout 에서도 생성 줄만 찾아낸다", () => {
    const out = "warn: something\n[snapshot-agents] ✅ 생성 27개 / skip 0개\ndone";
    expect(parseSnapshotCount(out)).toBe(27);
  });

  it("매칭이 없으면 undefined 를 반환한다", () => {
    expect(parseSnapshotCount("no count here")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/features/catalog-refresh/lib/parseSnapshotCount.test.ts`
Expected: FAIL — `Cannot find module './parseSnapshotCount'`

- [ ] **Step 3: types.ts 작성**

`apps/dashboard/src/features/catalog-refresh/model/types.ts`:

```typescript
// catalog-refresh feature 의 공용 타입.
// dev 전용 카탈로그 재생성 버튼이 소비하는 kind·결과 형태.

/** 재생성 대상 카탈로그 종류. 각 페이지 라우트 세그먼트와 일치. */
export type CatalogKind = "skills" | "plugins" | "agents";

/**
 * 재생성 결과 — 성공/실패 discriminated union.
 * - 성공(ok:true): count(파싱 실패 시 undefined) + warning(항상 존재, 덮어쓰기 안내).
 * - 실패(ok:false): error 만.
 */
export type RefreshResult =
  | { ok: true; count?: number; warning: string }
  | { ok: false; error: string };
```

- [ ] **Step 4: parseSnapshotCount.ts 작성**

`apps/dashboard/src/features/catalog-refresh/lib/parseSnapshotCount.ts`:

```typescript
// 스냅샷 스크립트의 완료 로그에서 생성 개수를 뽑는 순수 함수.
// 세 스크립트 모두 "✅ 생성 N개" 형식을 공유한다:
//   [snapshot-skills]  ✅ 생성 38개 / skip 2개 / 한글 overlay 36개
//   [snapshot-plugins] ✅ 생성 12개 / 활성 8 / ...
//   [snapshot-agents]  ✅ 생성 27개 / skip 0개

/** stdout 전체에서 "생성 N개" 의 N 을 파싱. 없으면 undefined. */
export function parseSnapshotCount(stdout: string): number | undefined {
  const match = stdout.match(/생성 (\d+)개/);
  return match ? Number(match[1]) : undefined;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/features/catalog-refresh/lib/parseSnapshotCount.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/catalog-refresh/model/types.ts \
        apps/dashboard/src/features/catalog-refresh/lib/parseSnapshotCount.ts \
        apps/dashboard/src/features/catalog-refresh/lib/parseSnapshotCount.test.ts
git commit -m "feat: catalog-refresh 타입 + stdout 개수 파싱 함수"
```

---

## Task 2: spawnSnapshot — server-only spawn 로직

기존 `pnpm <kind>:snapshot` 을 자식 프로세스로 실행하고 결과를 `RefreshResult` 로 반환하는 server-only 함수. dev 가드 + cwd 명시 포함.

**Files:**
- Create: `apps/dashboard/src/features/catalog-refresh/index.ts`

**Interfaces:**
- Consumes: `CatalogKind`, `RefreshResult` (Task 1), `parseSnapshotCount` (Task 1)
- Produces: `function spawnSnapshot(kind: CatalogKind): Promise<RefreshResult>`

**설계 노트:**
- repo root 계산: 이 파일은 `apps/dashboard/src/features/catalog-refresh/index.ts` 에 있으므로, `import.meta.url` 기준 상위 5단계(`catalog-refresh → features → src → dashboard → apps`)의 부모가 repo root. spawn 은 `apps/dashboard` 에서 `pnpm <kind>:snapshot` 을 돌려야 하므로 cwd 는 `apps/dashboard` 로 잡는다(root proxy 도 동작하지만 직접 지정이 명확).
- `spawn` 은 shell 없이 실행하고 stdout/stderr 를 수집.
- 이 함수는 server-only 이지만 `"use server"` 가 아니다 — Server Action 은 Task 3 의 client.ts 가 감싼다.

- [ ] **Step 1: index.ts 작성**

`apps/dashboard/src/features/catalog-refresh/index.ts`:

```typescript
// catalog-refresh feature — server-only entrypoint.
// 기존 pnpm <kind>:snapshot 을 child_process 로 실행한다.
// 스냅샷 스크립트를 직접 import 하지 않는 이유:
//   1) snapshot-*.ts 는 import.meta.url 기준으로 출력 경로를 잡는다 —
//      번들로 끌어오면 경로가 깨진다.
//   2) --conditions=react-server + server-only 엔티티를 끌어와, Server Action
//      모듈 그래프에 직접 넣으면 Gotcha #7 번들 경계 사고가 난다.
// subprocess 격리가 둘 다 원천 차단하고 이미 작동하는 호출을 재사용한다.
import "server-only";

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CatalogKind, RefreshResult } from "./model/types";
import { parseSnapshotCount } from "./lib/parseSnapshotCount";

export type { CatalogKind, RefreshResult } from "./model/types";

/** kind → package.json script 명. */
const SNAPSHOT_SCRIPTS: Record<CatalogKind, string> = {
  skills: "skills:snapshot",
  plugins: "plugins:snapshot",
  agents: "agents:snapshot",
};

/** kind → public/ body 디렉토리 (경고 문구용). */
const BODY_DIRS: Record<CatalogKind, string> = {
  skills: "public/skill-catalog/",
  plugins: "public/plugin-catalog/",
  agents: "public/agent-catalog/",
};

/** 이 파일 기준으로 apps/dashboard 디렉토리 절대경로를 계산. */
function dashboardDir(): string {
  // .../apps/dashboard/src/features/catalog-refresh/index.ts
  const here = dirname(fileURLToPath(import.meta.url));
  // catalog-refresh → features → src → dashboard
  return join(here, "..", "..", "..");
}

/**
 * 기존 pnpm <kind>:snapshot 을 실행해 카탈로그를 재생성한다.
 * dev 전용 — 운영에서는 소스 ~/.claude 가 없어 거부한다.
 */
export function spawnSnapshot(kind: CatalogKind): Promise<RefreshResult> {
  if (process.env.NODE_ENV === "production") {
    return Promise.resolve({
      ok: false,
      error: "운영 환경에서는 카탈로그 재생성이 지원되지 않습니다.",
    });
  }

  const script = SNAPSHOT_SCRIPTS[kind];
  const cwd = dashboardDir();

  return new Promise<RefreshResult>((resolve) => {
    const child = spawn("pnpm", [script], { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: `스냅샷 실행 실패: ${err.message}` });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `스냅샷이 실패했습니다 (exit ${code}). ${stderr.trim().slice(0, 500)}`,
        });
        return;
      }
      const count = parseSnapshotCount(stdout);
      resolve({
        ok: true,
        count,
        warning: `이 카탈로그는 현재 머신의 ~/.claude 기준으로 재생성됐습니다. catalog.json 과 ${BODY_DIRS[kind]} body 파일을 덮어썼습니다. 커밋 전 git diff 로 확인하세요.`,
      });
    });
  });
}
```

- [ ] **Step 2: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (0 errors)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/catalog-refresh/index.ts
git commit -m "feat: catalog-refresh spawnSnapshot — 기존 스냅샷 명령 subprocess 실행"
```

---

## Task 3: refreshCatalog — Server Action (client entrypoint)

`"use server"` Server Action. client 컴포넌트가 호출하는 RPC 경계. `spawnSnapshot` 을 감싸고 성공 시 `revalidatePath` 로 페이지 새로고침을 시도한다.

**Files:**
- Create: `apps/dashboard/src/features/catalog-refresh/client.ts`

**Interfaces:**
- Consumes: `spawnSnapshot` (Task 2), `CatalogKind`, `RefreshResult` (Task 1)
- Produces: `async function refreshCatalog(kind: CatalogKind): Promise<RefreshResult>`

**설계 노트:**
- Gotcha #7 패턴: 이 파일은 `"use server"` Server Action 만 노출. server-only `spawnSnapshot` 을 여기서 import 하지만, `"use server"` 파일 전체가 RPC 경계라 client 는 함수 참조만 받고 `spawnSnapshot`/`node:child_process` 는 client bundle 로 끌려오지 않는다.
- `revalidatePath("/" + kind)` — kind 가 곧 라우트 세그먼트(`/skills` 등)와 일치.

- [ ] **Step 1: client.ts 작성**

`apps/dashboard/src/features/catalog-refresh/client.ts`:

```typescript
// catalog-refresh feature — client-safe entrypoint.
// "use server" 파일 전체가 RPC 경계라, 여기서 server-only spawnSnapshot 을
// import 해도 client bundle 그래프로 끌려오지 않는다 (Gotcha #7 패턴).
// "use client" 컴포넌트는 이 entrypoint 로만 refreshCatalog 를 호출한다.
"use server";

import { revalidatePath } from "next/cache";

import type { CatalogKind, RefreshResult } from "./model/types";
import { spawnSnapshot } from "./index";

export type { CatalogKind, RefreshResult } from "./model/types";

/** 버튼 클릭 시 호출되는 Server Action. 재생성 후 해당 페이지 revalidate. */
export async function refreshCatalog(kind: CatalogKind): Promise<RefreshResult> {
  const result = await spawnSnapshot(kind);
  if (result.ok) {
    revalidatePath(`/${kind}`);
  }
  return result;
}
```

- [ ] **Step 2: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (0 errors)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/catalog-refresh/client.ts
git commit -m "feat: catalog-refresh refreshCatalog Server Action + revalidatePath"
```

---

## Task 4: CatalogRefreshButton — client 컴포넌트

버튼 UI. `useTransition` 으로 재생성 진행 상태를 관리하고, 완료 시 개수·경고를, 실패 시 에러를 표시. dev 전용 렌더 가드.

**Files:**
- Create: `apps/dashboard/src/features/catalog-refresh/ui/CatalogRefreshButton.tsx`
- Test: `apps/dashboard/src/features/catalog-refresh/ui/CatalogRefreshButton.test.tsx`

**Interfaces:**
- Consumes: `refreshCatalog` (Task 3), `CatalogKind`, `RefreshResult` (Task 1)
- Produces: `function CatalogRefreshButton(props: { kind: CatalogKind }): JSX.Element | null`

**설계 노트:**
- 코드베이스 관례(`PushSubscribeButton`)대로 `"use client"` + `useState` + `useTransition`.
- 운영 렌더 가드: `process.env.NODE_ENV === "production"` 이면 `null` 반환. Next.js 는 `process.env.NODE_ENV` 를 빌드 시점에 인라인하므로 client 번들에서도 안전하게 분기된다.
- 테스트에서 Server Action 을 mock 하려면 `refreshCatalog` 를 `vi.mock` 으로 대체.

- [ ] **Step 1: 컴포넌트의 실패 테스트 작성**

`apps/dashboard/src/features/catalog-refresh/ui/CatalogRefreshButton.test.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Server Action 을 mock — 실제 spawn 없이 결과만 주입.
const mockRefresh = vi.fn();
vi.mock("../client", () => ({
  refreshCatalog: (...args: unknown[]) => mockRefresh(...args),
}));

import { CatalogRefreshButton } from "./CatalogRefreshButton";

describe("CatalogRefreshButton", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
  });

  it("클릭하면 kind 로 refreshCatalog 를 호출하고 개수·경고를 표시한다", async () => {
    mockRefresh.mockResolvedValue({
      ok: true,
      count: 38,
      warning: "커밋 전 git diff 로 확인하세요.",
    });
    const user = userEvent.setup();
    render(<CatalogRefreshButton kind="skills" />);

    await user.click(screen.getByRole("button", { name: /새로고침|재생성/ }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledWith("skills"));
    expect(await screen.findByText(/38개/)).toBeInTheDocument();
    expect(screen.getByText(/git diff/)).toBeInTheDocument();
  });

  it("실패하면 에러 메시지를 표시한다", async () => {
    mockRefresh.mockResolvedValue({ ok: false, error: "스냅샷이 실패했습니다 (exit 1)." });
    const user = userEvent.setup();
    render(<CatalogRefreshButton kind="plugins" />);

    await user.click(screen.getByRole("button", { name: /새로고침|재생성/ }));

    expect(await screen.findByText(/실패했습니다/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/features/catalog-refresh/ui/CatalogRefreshButton.test.tsx`
Expected: FAIL — `Cannot find module './CatalogRefreshButton'`

- [ ] **Step 3: 컴포넌트 작성**

`apps/dashboard/src/features/catalog-refresh/ui/CatalogRefreshButton.tsx`:

```typescript
// 카탈로그 재생성 버튼 — dev 전용 client 컴포넌트.
// 클릭 시 refreshCatalog Server Action 을 호출해 ~/.claude 를 다시 스캔한다.
// 운영에서는 소스가 없어 렌더하지 않는다 (NODE_ENV 빌드 시점 인라인).
"use client";

import { useState, useTransition } from "react";

import { refreshCatalog } from "../client";
import type { CatalogKind, RefreshResult } from "../model/types";

interface CatalogRefreshButtonProps {
  kind: CatalogKind;
}

export function CatalogRefreshButton({ kind }: CatalogRefreshButtonProps) {
  // hook 은 항상 최상단에서 무조건 호출 (Rules of Hooks). 운영 가드는 hook 뒤 early return.
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);

  // 운영 렌더 가드 — NODE_ENV 는 빌드 시점 인라인. 소스 ~/.claude 없어 버튼 무의미.
  if (process.env.NODE_ENV === "production") return null;

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await refreshCatalog(kind);
      setResult(r);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
      >
        {isPending ? "재생성 중…" : "카탈로그 새로고침"}
      </button>
      {result?.ok && (
        <div className="max-w-xs text-right text-xs text-[var(--color-text-muted)]">
          <p>
            생성 {result.count ?? "?"}개 완료.
          </p>
          <p className="mt-0.5">{result.warning}</p>
          <p className="mt-0.5">즉시 반영이 안 되면 dev 서버 재시작이 필요할 수 있습니다.</p>
        </div>
      )}
      {result && !result.ok && (
        <p className="max-w-xs text-right text-xs text-[var(--color-danger)]">
          {result.error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/features/catalog-refresh/ui/CatalogRefreshButton.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/catalog-refresh/ui/CatalogRefreshButton.tsx \
        apps/dashboard/src/features/catalog-refresh/ui/CatalogRefreshButton.test.tsx
git commit -m "feat: CatalogRefreshButton — dev 전용 재생성 버튼 UI"
```

---

## Task 5: 세 페이지에 버튼 배치

`PageHeader` 의 `actions` 슬롯에 `CatalogRefreshButton` 을 꽂는다. 세 페이지 대칭 적용.

**Files:**
- Modify: `apps/dashboard/src/app/(dashboard)/skills/page.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/plugins/page.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/agents/page.tsx`

**Interfaces:**
- Consumes: `CatalogRefreshButton` (Task 4)

**설계 노트:**
- `PageHeader` 에 이미 `actions?: ReactNode` 슬롯이 있다 (`shared/ui/PageHeader.tsx`).
- server component 페이지가 client 컴포넌트를 자식으로 렌더하는 건 정상 (RSC → client boundary).
- import 는 feature 의 ui 를 직접 가리킨다: `@/features/catalog-refresh/ui/CatalogRefreshButton`. (client.ts 는 Server Action 전용 barrel 이고, 버튼 자체는 별도 경로. barrel 오염 방지를 위해 ui 컴포넌트를 index/client 에 re-export 하지 않는다.)

- [ ] **Step 1: skills 페이지 수정**

`apps/dashboard/src/app/(dashboard)/skills/page.tsx` — import 추가 + `PageHeader` 에 `actions` 전달:

```typescript
import { CatalogRefreshButton } from "@/features/catalog-refresh/ui/CatalogRefreshButton";
```

`PageHeader` 를 다음으로 교체:

```tsx
      <PageHeader
        title="Claude Code 스킬"
        subtitle={`설치된 스킬의 사용법과 출처를 살펴봅니다 (${skills.length}개).`}
        actions={<CatalogRefreshButton kind="skills" />}
      />
```

- [ ] **Step 2: plugins 페이지 수정**

`apps/dashboard/src/app/(dashboard)/plugins/page.tsx` — 동일 패턴. import 추가 후 `PageHeader` 에 `actions={<CatalogRefreshButton kind="plugins" />}` 추가. (기존 title/subtitle 은 그대로 두고 `actions` prop 만 덧붙인다.)

- [ ] **Step 3: agents 페이지 수정**

`apps/dashboard/src/app/(dashboard)/agents/page.tsx` — 동일 패턴. import 추가 후 `PageHeader` 에 `actions={<CatalogRefreshButton kind="agents" />}` 추가.

- [ ] **Step 4: typecheck + lint 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS (0 errors). lint 는 FSD boundary 규칙 포함 — `app → features` 참조는 허용 방향이라 통과해야 한다.

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(dashboard)/skills/page.tsx" \
        "apps/dashboard/src/app/(dashboard)/plugins/page.tsx" \
        "apps/dashboard/src/app/(dashboard)/agents/page.tsx"
git commit -m "feat: skills/plugins/agents 페이지에 카탈로그 새로고침 버튼 배치"
```

---

## Task 6: 빌드 검증 + HMR 반영 브라우저 확인

Gotcha #7(server/client 번들 경계)은 `typecheck`·`lint` 로 안 잡히고 `build` 로만 잡힌다. 그리고 spec 의 미검증 항목(HMR 자동 반영)을 브라우저로 실측한다.

**Files:** (변경 없음 — 검증 태스크)

- [ ] **Step 1: production build 통과 확인 (Gotcha #7 게이트)**

Run: `cd apps/dashboard && pnpm build`
Expected: 성공. `Module not found: Can't resolve 'tls'/'net'/'perf_hooks'` 같은 에러가 **없어야** 한다. 나오면 client 컴포넌트가 server-only 를 끌어온 것 — import 경로(`../client` vs `../index`)를 재점검.

- [ ] **Step 2: dev 서버로 HMR 반영 실측 (spec 미검증 항목)**

```bash
# dev 서버가 안 떠 있으면: pnpm dev (별도 터미널)
```

브라우저에서 (로그인 필요 — `/skills` 는 인증 없으면 307 리다이렉트):
1. `http://localhost:3020/skills` 로그인 후 접속, 헤더의 스킬 개수 확인.
2. "카탈로그 새로고침" 버튼 클릭 → "재생성 중…" → 완료.
3. **관측**: 페이지 헤더의 개수가 이 머신의 `~/.claude` 기준으로 바뀌는가?
   - **바뀌면**: `revalidatePath` + Turbopack 리컴파일로 자동 반영 확정. 폴백 안내는 보조.
   - **안 바뀌면**: dev 서버 재시작 후 반영되는지 확인. 이 경우 버튼 하단 "dev 서버 재시작 필요" 안내가 정확하다.

⚠️ **실측 후 워킹트리 복원 필수** — 재생성은 이 머신 기준으로 catalog.json 을 덮어쓴다(커밋 90개 → 이 머신 38개). 실측 뒤:

```bash
git checkout apps/dashboard/src/entities/skill/catalog.json \
             apps/dashboard/src/entities/plugin/*catalog.json \
             apps/dashboard/src/entities/agent/*catalog.json \
             apps/dashboard/public/skill-catalog/ \
             apps/dashboard/public/plugin-catalog/ \
             apps/dashboard/public/agent-catalog/
git clean -f apps/dashboard/public/skill-catalog/ \
             apps/dashboard/public/plugin-catalog/ \
             apps/dashboard/public/agent-catalog/
```

- [ ] **Step 3: 실측 결과를 spec 미검증 항목에 반영**

`docs/superpowers/specs/2026-07-14-catalog-refresh-button-design.md` 의 "미검증 항목" 섹션에 관측 결과를 한 줄 기록(HMR 반영 O/X + 폴백 안내 유효성). 커밋:

```bash
git add docs/superpowers/specs/2026-07-14-catalog-refresh-button-design.md
git commit -m "docs: 카탈로그 새로고침 HMR 반영 실측 결과 기록"
```

---

## Self-Review 결과

**1. Spec coverage:**
- 로컬 개발 전용 재생성 → Task 2 dev 가드 + Task 4 렌더 가드 ✓
- 페이지별 개별 버튼 → Task 5 (kind prop 3종) ✓
- 자동 반영 시도 + 폴백 안내 → Task 3 revalidatePath + Task 4 폴백 문구 ✓
- 덮어쓰기 경고 → Task 2 warning 문구(body 디렉토리 명시) + Task 4 렌더 ✓
- subprocess spawn 접근 → Task 2 ✓
- server/client seam(Gotcha #7) → Task 2 index.ts + Task 3 client.ts + Task 6 build 게이트 ✓
- HMR 미검증 라벨링 → Task 6 브라우저 실측 ✓

**2. Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "TBD"/"적절히 처리" 없음. ✓

**3. Type consistency:** `CatalogKind`·`RefreshResult`·`parseSnapshotCount`·`spawnSnapshot`·`refreshCatalog` 시그니처가 Task 1→2→3→4 에서 일관. `refreshCatalog(kind)` 반환 `RefreshResult` 를 Task 4 가 `result.ok` 로 분기 — 타입 정의와 일치. ✓
