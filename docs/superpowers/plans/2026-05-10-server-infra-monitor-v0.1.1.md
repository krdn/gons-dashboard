# Server Infra Monitor v0.1.1 — 좀비 정리 + Stale 감지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** home-server `projects` 테이블의 좀비 row 15개를 안전하게 제거하고, 향후 재발을 화이트리스트 검증으로 막고, live container 0개인 그룹을 UI에 "Stale" 배지로 표시한다.

**Architecture:** (1) `KNOWN_COMPOSE_PROJECTS_BY_HOST` 단일 소스에 화이트리스트 정의. (2) `upsertProjectFromContainer`가 화이트리스트 외 입력을 silent skip. (3) `groupByProject`를 컨테이너 기준 → project 기준으로 전환해 Stale 그룹도 표시. (4) idempotent `pnpm db:cleanup-projects [--apply]` 스크립트로 운영 환경 정리 수행. drizzle migration 파일은 만들지 않음 — cleanup 스크립트가 1회성 정리 + 영속적 도구를 동시 제공.

**Tech Stack:** TypeScript / Next.js 15 (App Router) / Drizzle ORM / Vitest / Tailwind / FSD

**Spec:** `docs/superpowers/specs/2026-05-10-server-infra-monitor-v0.1.1-cleanup-design.md`

---

## File Map

**신규 (3개):**
- `src/entities/project/config/knownComposeProjects.ts` — host별 화이트리스트
- `src/entities/project/api/isKnownComposeProject.ts` — 검증 헬퍼
- `src/scripts/cleanup-projects.ts` — idempotent cleanup (dry-run / --apply)
- `tests/known-compose-projects.test.ts` — 화이트리스트 단위 테스트
- `tests/cleanup-projects.test.ts` — cleanup 스크립트 통합 테스트 (test DB)

**수정 (5개):**
- `src/entities/project/api/upsertProjectFromContainer.ts` — 화이트리스트 검증 추가, return 타입 `Project | null`
- `src/entities/project/index.ts` — 신규 export 추가
- `src/scripts/seed-projects.ts` — `KNOWN_COMPOSE_PROJECTS_BY_HOST` 사용 (소스 단일화)
- `src/features/host-catalog/api/getHostsWithSummary.ts` — null 반환 필터링
- `src/features/container-list/lib/groupByProject.ts` — project 기준 그룹화로 전환, `isStale` 필드 추가
- `src/features/container-list/ui/ProjectGroupSection.tsx` — Stale 배지 렌더
- `tests/container-list-group-by-project.test.ts` — Stale 케이스 추가, 기존 케이스 갱신
- `package.json` — `db:cleanup-projects` script 추가
- `docs/RUNBOOK.md` — § "v0.1 서버 인프라 모니터"에 cleanup 절차 추가

---

## Sequencing 원칙

- 각 task는 자체 commit으로 끝남 (frequent commits)
- 빌드/타입 깨뜨리는 변경은 한 task 안에서 완결
- 화이트리스트 정의 → 검증 헬퍼 → upsert 수정 → seed-projects 정합성 → cleanup 스크립트 → groupByProject 리팩 → UI 배지 → RUNBOOK 순으로 의존성 맞춤

---

### Task 1: 화이트리스트 단일 소스 정의

**Files:**
- Create: `src/entities/project/config/knownComposeProjects.ts`
- Create: `tests/known-compose-projects.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/known-compose-projects.test.ts
import { describe, it, expect } from "vitest";
import {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "@/entities/project/config/knownComposeProjects";

describe("KNOWN_COMPOSE_PROJECTS_BY_HOST", () => {
  it("home-server의 라이브 compose project 8개가 모두 포함된다", () => {
    const set = KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"];
    expect(set).toBeDefined();
    expect(Array.from(set!).sort()).toEqual([
      "ai-afterschool-ex",
      "ai-afterschool-fsd",
      "cli-proxy-api",
      "docker",
      "docker-n8n",
      "gons-dashboard",
      "news-sentiment-analyzer2",
      "news-sentiment-prod",
    ]);
  });

  it("KNOWN_HOSTS는 BY_HOST 객체의 키 집합과 동일하다", () => {
    expect(Array.from(KNOWN_HOSTS).sort()).toEqual(
      Object.keys(KNOWN_COMPOSE_PROJECTS_BY_HOST).sort(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/known-compose-projects.test.ts`
Expected: FAIL — 모듈 미존재 ("Failed to resolve import").

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/entities/project/config/knownComposeProjects.ts
// 등록된 host별로 운영 중인 docker compose project 화이트리스트.
// seed-projects.ts와 upsertProjectFromContainer가 이 단일 소스를 공유한다.
//
// 새 compose project를 추가하려면:
//   1) 이 파일 KNOWN_COMPOSE_PROJECTS_BY_HOST에 키 추가
//   2) seed-projects.ts의 HOME_PROJECTS에 displayName/description/url/category 추가
//   3) `pnpm db:seed:projects` 재실행
export const KNOWN_COMPOSE_PROJECTS_BY_HOST: Record<
  string,
  ReadonlySet<string>
> = {
  "home-server": new Set([
    "ai-afterschool-ex",
    "ai-afterschool-fsd",
    "cli-proxy-api",
    "docker",
    "docker-n8n",
    "gons-dashboard",
    "news-sentiment-analyzer2",
    "news-sentiment-prod",
  ]),
};

export const KNOWN_HOSTS: ReadonlySet<string> = new Set(
  Object.keys(KNOWN_COMPOSE_PROJECTS_BY_HOST),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/known-compose-projects.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/entities/project/config/knownComposeProjects.ts tests/known-compose-projects.test.ts
git commit -m "feat(project): KNOWN_COMPOSE_PROJECTS_BY_HOST 화이트리스트 단일 소스 추가"
```

---

### Task 2: `isKnownComposeProject` 검증 헬퍼

**Files:**
- Create: `src/entities/project/api/isKnownComposeProject.ts`
- Modify: `src/entities/project/index.ts` — export 추가
- Test: 같은 파일 `tests/known-compose-projects.test.ts`에 추가

- [ ] **Step 1: Write the failing test (기존 파일에 describe 블록 추가)**

```typescript
// tests/known-compose-projects.test.ts — 파일 끝에 추가
import { isKnownComposeProject } from "@/entities/project";

describe("isKnownComposeProject", () => {
  it("화이트리스트에 있는 (host, compose) → true", () => {
    expect(isKnownComposeProject("home-server", "gons-dashboard")).toBe(true);
    expect(isKnownComposeProject("home-server", "docker-n8n")).toBe(true);
  });

  it("화이트리스트 외 compose → false", () => {
    expect(isKnownComposeProject("home-server", "n8n")).toBe(false);
    expect(isKnownComposeProject("home-server", "web")).toBe(false);
    expect(isKnownComposeProject("home-server", "ais-prod")).toBe(false);
  });

  it("등록되지 않은 host → false (보수적)", () => {
    expect(isKnownComposeProject("unknown-host", "gons-dashboard")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/known-compose-projects.test.ts`
Expected: FAIL — `isKnownComposeProject` import 해결 안 됨.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/entities/project/api/isKnownComposeProject.ts
import { KNOWN_COMPOSE_PROJECTS_BY_HOST } from "../config/knownComposeProjects";

export function isKnownComposeProject(
  hostName: string,
  composeProject: string,
): boolean {
  const set = KNOWN_COMPOSE_PROJECTS_BY_HOST[hostName];
  if (!set) return false;
  return set.has(composeProject);
}
```

```typescript
// src/entities/project/index.ts — export 라인 추가
export { isKnownComposeProject } from "./api/isKnownComposeProject";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/known-compose-projects.test.ts`
Expected: PASS — 5 tests pass (3 신규 + 2 기존).

- [ ] **Step 5: Commit**

```bash
git add src/entities/project/api/isKnownComposeProject.ts src/entities/project/index.ts tests/known-compose-projects.test.ts
git commit -m "feat(project): isKnownComposeProject 검증 헬퍼 (TDD)"
```

---

### Task 3: `upsertProjectFromContainer`에 화이트리스트 검증

**Files:**
- Modify: `src/entities/project/api/upsertProjectFromContainer.ts`
- Modify: `src/features/host-catalog/api/getHostsWithSummary.ts` — null 필터링
- Test: `tests/upsert-project-from-container.test.ts` (신규)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/upsert-project-from-container.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(async () => [
            {
              id: "p-uuid",
              hostId: "h-uuid",
              composeProject: "gons-dashboard",
              displayName: "gons-dashboard",
              description: null,
              category: null,
              url: null,
              isPinned: false,
              isHidden: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        })),
      })),
    })),
  },
}));

vi.mock("@/entities/host", () => ({
  getHostNameById: vi.fn(async (id: string) =>
    id === "h-uuid" ? "home-server" : null,
  ),
}));

import { upsertProjectFromContainer } from "@/entities/project/api/upsertProjectFromContainer";
import { db } from "@/shared/lib/db/client";

describe("upsertProjectFromContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("화이트리스트에 있는 compose → DB insert 실행 + Project 반환", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      composeProject: "gons-dashboard",
    });
    expect(result).not.toBeNull();
    expect(result?.composeProject).toBe("gons-dashboard");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("화이트리스트 외 compose → DB insert 없음 + null 반환", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      composeProject: "n8n",
    });
    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("등록 안 된 host → DB insert 없음 + null 반환", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "unknown",
      composeProject: "gons-dashboard",
    });
    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/upsert-project-from-container.test.ts`
Expected: FAIL — `getHostNameById` export 없음, 또는 화이트리스트 검증 미적용으로 모든 케이스가 insert를 호출.

- [ ] **Step 3a: 신규 헬퍼 `getHostNameById` 추가**

```typescript
// src/entities/host/api/getHostNameById.ts
import "server-only";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";

export async function getHostNameById(id: string): Promise<string | null> {
  const [row] = await db
    .select({ name: hosts.name })
    .from(hosts)
    .where(eq(hosts.id, id))
    .limit(1);
  return row?.name ?? null;
}
```

```typescript
// src/entities/host/index.ts — export 추가
export { getHostNameById } from "./api/getHostNameById";
```

- [ ] **Step 3b: `upsertProjectFromContainer` 수정**

```typescript
// src/entities/project/api/upsertProjectFromContainer.ts
import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { sql } from "drizzle-orm";
import { getHostNameById } from "@/entities/host";
import { isKnownComposeProject } from "./isKnownComposeProject";
import type { Project } from "../model/types";

export type UpsertInput = {
  hostId: string;
  composeProject: string;
};

export async function upsertProjectFromContainer(
  input: UpsertInput,
): Promise<Project | null> {
  const hostName = await getHostNameById(input.hostId);
  if (!hostName || !isKnownComposeProject(hostName, input.composeProject)) {
    console.warn(
      `[upsertProjectFromContainer] unknown compose=${input.composeProject} host=${hostName ?? input.hostId} — skipped`,
    );
    return null;
  }

  const [row] = await db
    .insert(projects)
    .values({
      hostId: input.hostId,
      composeProject: input.composeProject,
      displayName: input.composeProject,
    })
    .onConflictDoUpdate({
      target: [projects.hostId, projects.composeProject],
      set: { updatedAt: sql`now()` },
    })
    .returning();
  return row;
}
```

- [ ] **Step 3c: `getHostsWithSummary`에서 null 결과 필터링**

```typescript
// src/features/host-catalog/api/getHostsWithSummary.ts — line 41-49 부근 교체
let upsertedProjects: Project[] = projects;
if (unknown.length > 0) {
  const created = await Promise.all(
    unknown.map((composeProject) =>
      upsertProjectFromContainer({ hostId: host.id, composeProject }),
    ),
  );
  // 화이트리스트 외 compose는 upsert가 null을 반환 → standalone 그룹으로 합류
  const createdNonNull = created.filter((p): p is Project => p !== null);
  upsertedProjects = [...projects, ...createdNonNull];
}
```

> **참고**: `groupByProject`의 "unknown compose는 standalone fallback" 동작은 Task 6에서 project 기준 그룹화로 전환하면서 자연스럽게 처리된다. Task 3에서는 `getHostsWithSummary`의 null 필터링까지만 변경하고, `groupByProject`는 건드리지 않는다. 현행 `groupByProject`도 unknown compose에 대해 그룹을 만들기는 하지만 (displayName=composeProject 자체) UI상 큰 문제는 없으며, Task 6에서 일괄 정리됨.

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm test tests/upsert-project-from-container.test.ts`
Expected: PASS — 3 tests.

Run full suite to confirm no regression:
```bash
pnpm test
```
Expected: 모든 테스트 통과 (기존 `groupByProject` 4 cases 포함).

- [ ] **Step 5: Commit**

```bash
git add src/entities/host/api/getHostNameById.ts src/entities/host/index.ts \
        src/entities/project/api/upsertProjectFromContainer.ts \
        src/features/host-catalog/api/getHostsWithSummary.ts \
        tests/upsert-project-from-container.test.ts
git commit -m "feat(project): upsert 화이트리스트 검증 (TDD)"
```

---

### Task 4: `seed-projects.ts`를 화이트리스트 단일 소스에 정합

**Files:**
- Modify: `src/scripts/seed-projects.ts`

목적: seed의 `HOME_PROJECTS` 키 집합이 `KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"]`과 정확히 일치하는지 런타임 assert.

- [ ] **Step 1: 정합성 검증 로직 추가**

```typescript
// src/scripts/seed-projects.ts — main() 시작 부분에 추가
import { KNOWN_COMPOSE_PROJECTS_BY_HOST } from "@/entities/project/config/knownComposeProjects";

// ... 기존 imports + HOME_PROJECTS 정의 그대로 유지 ...

function assertSeedMatchesWhitelist(): void {
  const seedKeys = new Set(HOME_PROJECTS.map((p) => p.composeProject));
  const whitelistKeys = KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"];
  if (!whitelistKeys) {
    throw new Error(
      `seed-projects: KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"] 정의 없음`,
    );
  }
  const missingInSeed = [...whitelistKeys].filter((k) => !seedKeys.has(k));
  const missingInWhitelist = [...seedKeys].filter((k) => !whitelistKeys.has(k));
  if (missingInSeed.length > 0 || missingInWhitelist.length > 0) {
    throw new Error(
      `seed-projects ↔ KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"] 불일치.\n` +
        `  seed에 없음: ${missingInSeed.join(", ") || "(없음)"}\n` +
        `  whitelist에 없음: ${missingInWhitelist.join(", ") || "(없음)"}\n` +
        `둘 중 하나에만 추가됐을 가능성 — 양쪽 동시 갱신 필요.`,
    );
  }
}

async function main() {
  assertSeedMatchesWhitelist();   // 신규: 첫 줄 추가
  const homeId = await getHostId("home-server");
  for (const p of HOME_PROJECTS) await upsertOne(homeId, p);
  // ... 기존 로직 유지 ...
}
```

- [ ] **Step 2: Run seed locally to verify**

Run: `DATABASE_URL=postgres://gons:gons@localhost:5440/gons_dashboard pnpm db:seed:projects` (또는 운영 .env로 dry-run 환경)
Expected: `assertSeedMatchesWhitelist`가 통과 (양쪽 모두 8개 동일). seed가 8개 row upsert 후 종료.

> 운영 DB 접속이 어려우면 임시로 `assertSeedMatchesWhitelist()`만 호출하는 작은 스크립트로 검증해도 됨. 핵심은 **두 set이 동일하다**는 사실 확인.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/seed-projects.ts
git commit -m "fix(seed-projects): 화이트리스트와 seed key 정합성 런타임 assert"
```

---

### Task 5: `pnpm db:cleanup-projects` 스크립트

**Files:**
- Create: `src/scripts/cleanup-projects.ts`
- Modify: `package.json` — script 추가
- Test: `tests/cleanup-projects.test.ts` (pure function 단위)

> **결정**: 스크립트의 핵심은 "어떤 row가 좀비인가"를 판별하는 pure function. 이 부분만 단위 테스트로 검증하고, DB 통합은 운영 dry-run으로 수동 검증한다.

- [ ] **Step 1: Write the failing test (pure function)**

```typescript
// tests/cleanup-projects.test.ts
import { describe, it, expect } from "vitest";
import { computeZombieIds } from "@/scripts/cleanup-projects.lib";

describe("computeZombieIds", () => {
  const dbRows = [
    { id: "1", composeProject: "gons-dashboard" },
    { id: "2", composeProject: "docker" },
    { id: "3", composeProject: "ghost" },
    { id: "4", composeProject: "another-zombie" },
    { id: "5", composeProject: "ais-prod" },
  ];

  it("live + whitelist 합집합 외의 row id를 반환", () => {
    const live = new Set(["gons-dashboard", "docker"]);
    const whitelist = new Set(["gons-dashboard", "docker", "cli-proxy-api"]);
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies.sort()).toEqual(["3", "4", "5"]);
  });

  it("live만 있고 whitelist 비어있으면 live 외 전부 좀비", () => {
    const live = new Set(["gons-dashboard"]);
    const whitelist = new Set<string>();
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies.sort()).toEqual(["2", "3", "4", "5"]);
  });

  it("whitelist만 있고 live 비어있어도 whitelist는 보존", () => {
    const live = new Set<string>();
    const whitelist = new Set(["gons-dashboard", "docker"]);
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies.sort()).toEqual(["3", "4", "5"]);
  });

  it("좀비 없으면 빈 배열", () => {
    const live = new Set(["gons-dashboard", "docker", "ghost", "another-zombie", "ais-prod"]);
    const whitelist = new Set<string>();
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cleanup-projects.test.ts`
Expected: FAIL — `@/scripts/cleanup-projects.lib` 모듈 미존재.

- [ ] **Step 3a: Pure function 구현**

```typescript
// src/scripts/cleanup-projects.lib.ts
// cleanup-projects의 pure 로직만 분리 (단위 테스트 가능).

export type ProjectIdRow = {
  id: string;
  composeProject: string;
};

export function computeZombieIds(
  dbRows: readonly ProjectIdRow[],
  liveComposeSet: ReadonlySet<string>,
  whitelistSet: ReadonlySet<string>,
): string[] {
  const known = new Set([...liveComposeSet, ...whitelistSet]);
  return dbRows
    .filter((r) => !known.has(r.composeProject))
    .map((r) => r.id);
}
```

- [ ] **Step 3b: 스크립트 본체 구현**

```typescript
// src/scripts/cleanup-projects.ts
// 운영 DB의 좀비 project row를 식별·삭제하는 idempotent 스크립트.
// 기본 dry-run. --apply로 실제 삭제.
//
// 기준: live container의 compose 라벨 set ∪ KNOWN_COMPOSE_PROJECTS_BY_HOST 의 합집합.
// 합집합 외의 row가 좀비.
//
// 실행: `pnpm db:cleanup-projects [--apply]`
import "dotenv/config";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { getHosts } from "@/entities/host";
import { listContainers } from "@/entities/container";
import { KNOWN_COMPOSE_PROJECTS_BY_HOST } from "@/entities/project/config/knownComposeProjects";
import { computeZombieIds } from "./cleanup-projects.lib";

async function main() {
  const apply = process.argv.includes("--apply");
  const hosts = await getHosts();

  let totalZombies = 0;

  for (const host of hosts) {
    const liveSet = new Set<string>();
    try {
      const containers = await listContainers({
        hostId: host.id,
        dockerContext: host.dockerContext,
      });
      for (const c of containers) {
        if (c.composeProject != null) liveSet.add(c.composeProject);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[${host.name}] docker 통신 실패 (${msg}) — whitelist만으로 비교 (보수적)`,
      );
    }

    const whitelist = KNOWN_COMPOSE_PROJECTS_BY_HOST[host.name] ?? new Set();
    const dbRows = await db
      .select({ id: projects.id, composeProject: projects.composeProject })
      .from(projects)
      .where(eq(projects.hostId, host.id));

    const zombieIds = computeZombieIds(dbRows, liveSet, whitelist);

    if (zombieIds.length === 0) {
      console.log(`[${host.name}] 좀비 없음 (DB ${dbRows.length} rows)`);
      continue;
    }

    const zombieRows = dbRows.filter((r) => zombieIds.includes(r.id));
    console.log(
      `[${host.name}] 좀비 후보 ${zombieIds.length}개 (전체 ${dbRows.length} rows):`,
    );
    for (const r of zombieRows) {
      console.log(`  - ${r.composeProject}`);
    }
    totalZombies += zombieIds.length;

    if (apply) {
      await db.delete(projects).where(inArray(projects.id, zombieIds));
      console.log(`[${host.name}] ✅ 삭제 완료`);
    } else {
      console.log(
        `[${host.name}] dry-run. 실제 삭제: \`pnpm db:cleanup-projects --apply\``,
      );
    }
  }

  console.log(
    `\n총 ${totalZombies}개 ${apply ? "삭제됨" : "삭제 후보"}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ cleanup failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3c: package.json script 추가**

```json
// package.json — "scripts" 객체에 추가
"db:cleanup-projects": "tsx --conditions=react-server src/scripts/cleanup-projects.ts"
```

- [ ] **Step 4: Run unit tests + dry-run**

Run unit:
```bash
pnpm test tests/cleanup-projects.test.ts
```
Expected: PASS — 4 tests.

Run dry-run against 운영 DB (DATABASE_URL이 운영 향함):
```bash
pnpm db:cleanup-projects
```
Expected output:
```
[home-server] 좀비 후보 15개 (전체 23 rows):
  - ai-afterschool
  - ai-afterschool-fsd-web
  - ai-health
  - ai-model-setup
  - ai-news-analyzer
  - ais-collector
  - ais-prod
  - krdn-fx
  - n8n
  - news-prod
  - nitter
  - open-webui
  - voice
  - vscode
  - web
[home-server] dry-run. 실제 삭제: `pnpm db:cleanup-projects --apply`

총 15개 삭제 후보.
```

> docker context가 안 되는 환경(예: CI)에서는 docker 실패 메시지 + whitelist만으로 비교 가능. 양쪽 다 정상.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/cleanup-projects.ts src/scripts/cleanup-projects.lib.ts \
        package.json tests/cleanup-projects.test.ts
git commit -m "feat(scripts): db:cleanup-projects — idempotent 좀비 정리 (TDD)"
```

---

### Task 6: `groupByProject` 전환 — project 기준 그룹화 + Stale 필드

**Files:**
- Modify: `src/features/container-list/lib/groupByProject.ts`
- Modify: `tests/container-list-group-by-project.test.ts`

목표: 컨테이너 기준 → project 기준 그룹화로 전환. project row가 있는데 매칭 컨테이너가 0개면 `isStale=true` 그룹 생성. 결과적으로 메인 페이지에서 stop된 compose도 "no live containers" 배지로 표시됨.

- [ ] **Step 1: 새 케이스 추가 (먼저 작성, 아직 실패)**

```typescript
// tests/container-list-group-by-project.test.ts — describe 안에 추가
it("project 메타가 있는데 live container 0개 → isStale=true 그룹", () => {
  const projects = [
    p({ composeProject: "always-running", displayName: "Live" }),
    p({ composeProject: "stopped", displayName: "Stopped" }),
  ];
  const containers = [
    c({ id: "1", composeProject: "always-running" }),
  ];
  const groups = groupByProject(containers, projects);
  expect(groups).toHaveLength(2);
  const live = groups.find((g) => g.composeProject === "always-running")!;
  expect(live.isStale).toBe(false);
  expect(live.containers).toHaveLength(1);
  const stale = groups.find((g) => g.composeProject === "stopped")!;
  expect(stale.isStale).toBe(true);
  expect(stale.containers).toHaveLength(0);
  expect(stale.runningCount).toBe(0);
  expect(stale.totalCount).toBe(0);
});

it("hidden project는 live container가 있어도 그룹 누락 (stale도 누락)", () => {
  const projects = [
    p({ composeProject: "noisy", isHidden: true }),
  ];
  const containers = [c({ id: "1", composeProject: "noisy" })];
  const groups = groupByProject(containers, projects);
  expect(groups).toHaveLength(0);
});

it("standalone 그룹은 isStale=false (live container가 정의상 1+)", () => {
  const groups = groupByProject(
    [c({ id: "1", name: "open-webui", composeProject: null })],
    [],
  );
  expect(groups[0].isStandalone).toBe(true);
  expect(groups[0].isStale).toBe(false);
});
```

기존 케이스 4개 모두 `isStale: false` 필드를 가져야 하므로 expected 갱신 필요. 단순히 `expect(group.isStale).toBe(false)` 한 줄을 적절히 추가하거나, 기존 케이스가 isStale을 검사하지 않으니 그대로 두어도 통과.

- [ ] **Step 2: Run test to verify new cases fail**

Run: `pnpm test tests/container-list-group-by-project.test.ts`
Expected: FAIL — `isStale` 필드 없음, "stopped" 그룹이 결과에 포함되지 않음.

- [ ] **Step 3: 구현 — `groupByProject` 전환**

```typescript
// src/features/container-list/lib/groupByProject.ts — 전체 교체
import type { ContainerSummary, ContainerState } from "@/entities/container";
import type { Project } from "@/entities/project";

export type ProjectGroup = {
  composeProject: string;
  displayName: string;
  description: string | null;
  category: string | null;
  url: string | null;
  isPinned: boolean;
  isStandalone: boolean;
  isStale: boolean;
  containers: ContainerSummary[];
  runningCount: number;
  totalCount: number;
  warningCount: number;
};

const WARNING_STATES: ReadonlySet<ContainerState> = new Set([
  "exited",
  "restarting",
  "dead",
  "paused",
]);

const STANDALONE = "standalone";

function makeGroup(args: {
  composeProject: string;
  displayName: string;
  description: string | null;
  category: string | null;
  url: string | null;
  isPinned: boolean;
  isStandalone: boolean;
  containers: ContainerSummary[];
}): ProjectGroup {
  let running = 0;
  let warning = 0;
  for (const cont of args.containers) {
    if (cont.state === "running") running++;
    if (WARNING_STATES.has(cont.state)) warning++;
  }
  return {
    ...args,
    isStale: !args.isStandalone && args.containers.length === 0,
    runningCount: running,
    totalCount: args.containers.length,
    warningCount: warning,
  };
}

export function groupByProject(
  containers: ContainerSummary[],
  projects: Project[],
): ProjectGroup[] {
  const visibleProjects = projects.filter((p) => !p.isHidden);
  const visibleByCompose = new Map(
    visibleProjects.map((p) => [p.composeProject, p]),
  );
  const hiddenSet = new Set(
    projects.filter((p) => p.isHidden).map((p) => p.composeProject),
  );

  // 1. 각 visible project를 슬롯으로 만든다 (live 0개여도 그룹 생성).
  const projectBuckets = new Map<string, ContainerSummary[]>(
    visibleProjects.map((p) => [p.composeProject, []]),
  );
  const standaloneBucket: ContainerSummary[] = [];

  // 2. 컨테이너를 슬롯에 분배.
  for (const cont of containers) {
    if (cont.composeProject == null) {
      standaloneBucket.push(cont);
      continue;
    }
    if (hiddenSet.has(cont.composeProject)) continue; // hidden은 표시 안 함
    const slot = projectBuckets.get(cont.composeProject);
    if (slot != null) {
      slot.push(cont);
    } else {
      // visible project에 매칭 안 되면 standalone fallback
      standaloneBucket.push(cont);
    }
  }

  // 3. 그룹 생성.
  const groups: ProjectGroup[] = [];
  for (const [key, list] of projectBuckets) {
    const meta = visibleByCompose.get(key)!;
    groups.push(
      makeGroup({
        composeProject: key,
        displayName: meta.displayName,
        description: meta.description ?? null,
        category: meta.category ?? null,
        url: meta.url ?? null,
        isPinned: meta.isPinned,
        isStandalone: false,
        containers: list,
      }),
    );
  }
  if (standaloneBucket.length > 0) {
    groups.push(
      makeGroup({
        composeProject: STANDALONE,
        displayName: "standalone",
        description: null,
        category: null,
        url: null,
        isPinned: false,
        isStandalone: true,
        containers: standaloneBucket,
      }),
    );
  }

  return groups.sort((a, b) => {
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.composeProject.localeCompare(b.composeProject);
  });
}
```

- [ ] **Step 4: Run all tests to verify pass**

Run: `pnpm test tests/container-list-group-by-project.test.ts`
Expected: PASS — 기존 4 + 신규 4 = 8 tests.

Run full suite to catch regressions:
```bash
pnpm test
```
Expected: 모든 테스트 통과 (Task 3에서 추가한 standalone fallback 케이스 포함).

- [ ] **Step 5: Commit**

```bash
git add src/features/container-list/lib/groupByProject.ts tests/container-list-group-by-project.test.ts
git commit -m "feat(container-list): project 기준 그룹화 + isStale 필드 (TDD)"
```

---

### Task 7: Stale 배지 UI

**Files:**
- Modify: `src/features/container-list/ui/ProjectGroupSection.tsx`

목적: `group.isStale === true`인 경우 헤더에 회색 "no live containers" 배지 + 컨테이너 영역에 안내 문구.

현재 구조: `ProjectCard`가 헤더(displayName/카운트/배지/포트)를 렌더하고, 자식으로 `<ul>` 안에 `ContainerRow` 리스트를 받는다. v0.1.1에서는 (a) `ProjectCard`에 `isStale` prop을 흘려보내 헤더에 배지를 추가하거나, (b) `ProjectGroupSection`에서 children 위에 안내 문구를 띄우는 방법 둘 다 가능. 여기서는 **외부 의존성 최소화**를 위해 (b) 방식 선택 — `ProjectCard` 시그니처를 건드리지 않고 children만 변경.

- [ ] **Step 1: `ProjectGroupSection` 전체 교체**

```tsx
// src/features/container-list/ui/ProjectGroupSection.tsx
import { ContainerRow } from "@/entities/container";
import { ProjectCard } from "@/entities/project";
import type { ProjectGroup } from "../lib/groupByProject";
import { collectHostPorts } from "../lib/collectHostPorts";

type Props = {
  group: ProjectGroup;
  renderActions?: (containerId: string, containerName: string) => React.ReactNode;
};

export function ProjectGroupSection({ group, renderActions }: Props) {
  return (
    <ProjectCard
      project={{
        displayName: group.displayName,
        description: group.description,
        isPinned: group.isPinned,
        composeProject: group.composeProject,
        category: group.category,
        url: group.url,
      }}
      totalContainers={group.totalCount}
      runningContainers={group.runningCount}
      warningCount={group.warningCount}
      hostPorts={collectHostPorts(group.containers)}
    >
      {group.isStale ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-600">
          <span
            className="inline-flex items-center rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700"
            title="화이트리스트엔 등록되어 있으나 현재 실행 중인 컨테이너가 없습니다"
          >
            no live containers
          </span>
          <span>실행 중인 컨테이너가 없습니다</span>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {group.containers.map((c) => (
            <li key={c.id}>
              <ContainerRow
                container={c}
                actions={renderActions ? renderActions(c.id, c.name) : null}
              />
            </li>
          ))}
        </ul>
      )}
    </ProjectCard>
  );
}
```

- [ ] **Step 2: 시각 검증 (수동)**

로컬에서 stale 그룹을 만들기 어려우므로, 임시로 한 컨테이너를 stop해서 검증한다.

```bash
docker --context home-server stop ais-prod-redis  # ais-prod-redis 1대만 stop (docker compose의 일부)
# 컨테이너가 6개 → 5개로 줄지만 group은 여전히 live → isStale=false
# 진짜 stale을 보려면 compose 전체를 down해야 하지만 운영 영향이 있으니 권장 X
docker --context home-server start ais-prod-redis
```

대안 검증: 운영 cleanup(Task 9) 후 좀비 정리되면, 화이트리스트엔 있지만 stop된 compose가 생기는 시점에 자연 검증됨. 또는 통합 테스트로 확인하려면 임의 project row를 DB에 넣고 새로고침.

- [ ] **Step 3: 시각 검증 (수동)**

Run dev server:
```bash
pnpm dev
```

브라우저에서 `http://localhost:3020/`. 좀비 정리 전엔 stale 그룹이 안 보일 수 있음 (운영 cleanup 후 검증). 로컬에서 일부러 stale 그룹을 만들려면 임의 compose project를 화이트리스트에 추가 후 컨테이너 없이 seed 실행.

대안: 다음 명령으로 컨테이너 1개를 잠시 stop해서 그룹이 비어가는지 확인:
```bash
docker --context home-server stop cli-proxy-api
# / 새로고침 → cli-proxy-api 그룹이 isStale=true로 표시
docker --context home-server start cli-proxy-api
```

- [ ] **Step 3: tsc + lint 통과 확인**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/features/container-list/ui/ProjectGroupSection.tsx
git commit -m "feat(ui): Stale 그룹에 'no live containers' 배지"
```

---

### Task 8: RUNBOOK § cleanup 절차 추가

**Files:**
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: § "v0.1 서버 인프라 모니터" 안 "자주 발생하는 이슈" 위에 추가**

```markdown
### Project 좀비 row 정리

운영 중 `projects` 테이블에 라이브 컨테이너에 매칭되지 않는 row가 누적될 수 있다 (stop된 compose, 이름 혼동 등). v0.1.1부터 화이트리스트(`KNOWN_COMPOSE_PROJECTS_BY_HOST`) 검증으로 lazy upsert는 차단되지만, 과거 데이터는 cleanup 도구로 정리한다.

```bash
# dry-run — 좀비 후보만 출력
pnpm db:cleanup-projects

# 실제 삭제
pnpm db:cleanup-projects --apply

# seed 재실행으로 displayName/description 정렬
pnpm db:seed:projects
```

기준:
- live 컨테이너의 `com.docker.compose.project` 라벨 set
- `KNOWN_COMPOSE_PROJECTS_BY_HOST[host.name]` 화이트리스트
- 합집합 외의 row가 "좀비"

새 compose project를 추가하려면:
1. `src/entities/project/config/knownComposeProjects.ts`의 host set에 키 추가
2. `src/scripts/seed-projects.ts`의 `HOME_PROJECTS`에 displayName/category/url 추가
3. `pnpm db:seed:projects` 실행 (정합성 assert 통과 + upsert)
```

- [ ] **Step 2: v0.2 후보 절에 보류 항목 추가 (있다면)**

`docs/RUNBOOK.md` 또는 `TODOS.md`의 v0.2 후보 섹션에:
```markdown
- Cluster-aware grouping: `news-sentiment-prod` + `news-sentiment-analyzer2`를 "뉴스 서비스" 단일 그룹으로 묶기 (현재는 compose project 단위)
- 좀비 자동 cleanup (cron) — grace period 결정 후
```

- [ ] **Step 3: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "docs(runbook): cleanup-projects 절차 + 새 compose 추가 가이드"
```

---

### Task 9: 운영 환경 적용 + 검증

**Files:** 없음 (운영 작업)

- [ ] **Step 1: PR 머지 + GHA 빌드 완료 대기**

GitHub Actions에서 `gons-dashboard` + `gons-dashboard-cron` 이미지 빌드 완료 확인.

- [ ] **Step 2: 새 이미지 pull + 무중단 재시작**

```bash
dcserver pull app cron
dcserver up -d app cron
curl -sS https://gons.krdn.kr/api/health
```

- [ ] **Step 3: dry-run으로 좀비 후보 확인**

```bash
# 운영 환경 .env가 적용된 셸에서
pnpm db:cleanup-projects
```

Expected: 정확히 15개 후보 (spec 부록 A와 일치).

- [ ] **Step 4: --apply로 실제 정리**

```bash
pnpm db:cleanup-projects --apply
pnpm db:seed:projects
```

- [ ] **Step 5: UI 검증**

`https://gons.krdn.kr/` 접속:
- [ ] 메인 페이지 그룹 수 = 8개 (visible project) + standalone(open-webui, krdn-timescaledb)
- [ ] "AI 방과후 (운영)" 그룹 1개만 (중복 사라짐)
- [ ] "뉴스 서비스" 변형 모두 정리
- [ ] 모든 그룹에 컨테이너 1개 이상 (isStale 그룹 없음)

- [ ] **Step 6: DB 상태 확인 SQL**

```bash
dserver exec gons-dashboard-postgres psql -U gons -d gons_dashboard -c \
  "SELECT compose_project, display_name FROM projects ORDER BY compose_project;"
```

Expected: 정확히 8 rows (home-server의 라이브 compose project 8개).

- [ ] **Step 7: 좀비 정리 결과 commit (없으면 skip)**

코드 변경 없음. 운영 작업 끝.

---

## 자체 검토 체크리스트 (작업 시작 전)

- [ ] Task 1-8 모든 step에 코드/명령어 placeholder 없음
- [ ] Task 6에서 `groupByProject` 전환은 기존 4개 케이스 호환 + 신규 3개 추가로 회귀 방지
- [ ] Task 5의 `db:cleanup-projects`는 dry-run 기본, `--apply` 명시로만 삭제
- [ ] Task 4의 정합성 assert가 화이트리스트와 seed 양쪽 모두 동일 set임을 강제
- [ ] Task 9의 운영 절차가 spec §7 "마이그레이션/배포 순서"와 일치
- [ ] 신규/수정 파일 모두 file map과 일치
- [ ] FSD 의존성 방향 위배 없음 (entities → shared만 참조, features → entities 참조)

---

## Spec 커버리지 매핑

| Spec 섹션 | 구현 Task |
|----------|----------|
| §3 D2 (1회성 SQL + seed 재실행) | Task 5 (cleanup 스크립트가 마이그레이션 역할) + Task 9 step 3-4 |
| §3 D3 (실시간 stale 감지) | Task 6 (`groupByProject`에 isStale) |
| §3 D4 (`pnpm db:cleanup-projects`) | Task 5 |
| §3 D5 (live container 0개 = stale) | Task 6 makeGroup의 `isStale` 계산 |
| §3 D6 (lazy upsert 화이트리스트 검증) | Task 1+2+3 |
| §4.1 `isKnownComposeProject` | Task 2 |
| §4.2 `upsertProjectFromContainer` 수정 | Task 3 |
| §4.3 `groupByProject` 전환 | Task 6 |
| §4.4 1회성 정리 | Task 5 (drizzle migration 대신 cleanup 스크립트로 통합) |
| §4.5 cleanup 스크립트 | Task 5 |
| §4.6 UI Stale 배지 | Task 7 |
| §5 에러 처리 (docker 다운) | Task 5 step 3b의 try-catch + warn |
| §6 테스트 전략 (단위/통합/수동) | Task 1, 2, 3, 5, 6의 테스트 step + Task 9 수동 검증 |
| §7 배포 순서 | Task 9 |
| 부록 A (23개 row 분류) | Task 9 step 3 dry-run으로 검증 |
