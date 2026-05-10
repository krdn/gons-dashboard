# 서버 인프라 모니터 — 구현 계획 (v0.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 192.168.0.5 운영 서버의 Docker 컨테이너를 `compose project label`로 그룹화해 대시보드 메인 카드 + 호스트 상세 페이지에 노출하고, 인증된 admin이 restart/start/stop을 실행하면 audit log에 기록한다.

**Architecture:** Next.js RSC가 `docker --context home-server` CLI을 `execFile`로 직접 호출 (dockerode 미사용 — SSH 트랜스포트 단순화). Docker 결과는 NDJSON으로 받아 Zod로 파싱. `hosts`/`projects`/`audit_logs` 3개 테이블 추가. 컨테이너 라이브 데이터는 DB에 저장하지 않고 매번 호출 (스냅샷 only). 클라이언트는 TanStack Query로 60s/30s 폴링.

**Tech Stack:** Next.js 16 (App Router, RSC) · TypeScript · Drizzle ORM · PostgreSQL · NextAuth v5 · Zod · TanStack Query · Vitest · Testing Library · Playwright.

**Spec:** `docs/superpowers/specs/2026-05-10-server-infra-monitor-design.md`

---

## 파일 구조 (생성/수정 청사진)

### 생성

| 파일 | 책임 |
|---|---|
| `drizzle/0002_server_infra.sql` | drizzle-kit 자동 생성 — `hosts`/`projects`/`audit_logs` |
| `src/scripts/seed-hosts.ts` | `home-server` 1개 등록 (idempotent upsert) |
| `src/shared/lib/docker/runDocker.ts` | `execFile` 어댑터 — `docker --context <ctx> <args>` |
| `src/shared/lib/docker/parseContainer.ts` | NDJSON line → `ContainerSummary` (Zod) |
| `src/shared/lib/docker/listContainers.ts` | `docker container ls` → `ContainerSummary[]` |
| `src/shared/lib/docker/inspectContainer.ts` | `docker inspect <id>` → `ContainerInspect` |
| `src/shared/lib/docker/maskEnv.ts` | env key 패턴 매칭 → 값 마스킹 |
| `src/shared/lib/docker/index.ts` | public API |
| `src/entities/host/model/types.ts` | `Host` 타입 + Zod schema |
| `src/entities/host/api/getHosts.ts` | `hosts` SELECT |
| `src/entities/host/api/getHostByName.ts` | name unique lookup |
| `src/entities/host/ui/HostBadge.tsx` | 호스트명 + 상태 점 |
| `src/entities/host/index.ts` | public API |
| `src/entities/project/model/types.ts` | `Project` 타입 |
| `src/entities/project/api/getProjects.ts` | host별 SELECT (`isHidden=false`) |
| `src/entities/project/api/upsertProjectFromContainer.ts` | (hostId, composeProject) upsert |
| `src/entities/project/ui/ProjectCard.tsx` | 프로젝트 헤더 카드 (display name, 카운트) |
| `src/entities/project/index.ts` | public API |
| `src/entities/container/model/types.ts` | `ContainerSummary`/`ContainerInspect` re-export, `PortMapping` |
| `src/entities/container/api/listContainers.ts` | shared/lib/docker 래핑 + hostId 주입 |
| `src/entities/container/api/inspectContainer.ts` | inspect + envMasked 적용 |
| `src/entities/container/ui/ContainerStatusBadge.tsx` | state별 색상/아이콘 |
| `src/entities/container/ui/ContainerRow.tsx` | 한 행 표시 (액션 슬롯 받음) |
| `src/entities/container/index.ts` | public API |
| `src/features/host-catalog/api/getHostsWithSummary.ts` | host + projectGroups 조립 |
| `src/features/host-catalog/index.ts` | public API |
| `src/features/container-list/lib/groupByProject.ts` | pure function — containers → ProjectGroup[] |
| `src/features/container-list/ui/ProjectGroupSection.tsx` | 한 프로젝트의 컨테이너 모음 |
| `src/features/container-list/ui/StandaloneSection.tsx` | 라벨 없는 컨테이너 모음 |
| `src/features/container-list/index.ts` | public API |
| `src/features/container-actions/api/restartContainer.ts` | Server Action |
| `src/features/container-actions/api/startContainer.ts` | Server Action |
| `src/features/container-actions/api/stopContainer.ts` | Server Action |
| `src/features/container-actions/api/insertAuditLog.ts` | 내부 헬퍼 |
| `src/features/container-actions/lib/isAdmin.ts` | session.email ∈ ADMIN_EMAILS |
| `src/features/container-actions/ui/ActionButtons.tsx` | restart/start/stop 버튼 + 확인 다이얼로그 |
| `src/features/container-actions/ui/AuditLogPanel.tsx` | 최근 5건 표시 (RSC) |
| `src/features/container-actions/index.ts` | public API |
| `src/widgets/server-overview/ui/ServerOverviewCard.tsx` | 메인 카드 RSC + 클라 polling wrapper |
| `src/widgets/server-overview/ui/ServerOverviewSkeleton.tsx` | 로딩 |
| `src/widgets/server-overview/ui/ServerOverviewError.tsx` | daemon 끊김 배너 |
| `src/widgets/server-overview/index.ts` | public API |
| `src/app/servers/[hostName]/page.tsx` | 호스트 상세 RSC |
| `src/app/servers/[hostName]/loading.tsx` | suspense fallback |
| `src/app/servers/[hostName]/error.tsx` | error boundary |
| `tests/docker-parse-container.test.ts` | parseContainer unit |
| `tests/docker-list-containers.test.ts` | listContainers (execFile mock) |
| `tests/docker-mask-env.test.ts` | maskEnv unit |
| `tests/host-api.test.ts` | getHosts/getHostByName (PG) |
| `tests/project-api.test.ts` | getProjects/upsertProjectFromContainer (PG) |
| `tests/container-list-group-by-project.test.ts` | groupByProject pure |
| `tests/container-actions.test.ts` | restart/start/stop integration (PG + docker mock) |
| `tests/server-overview-card.test.tsx` | RSC 컴포넌트 (mock entities) |
| `tests/e2e/server-infra.spec.ts` | Playwright + docker shim |
| `tests/fixtures/docker-mock-shim.mjs` | E2E용 docker CLI 대체 스크립트 |
| `tests/fixtures/docker-ndjson/` | 시나리오별 NDJSON fixture |

### 수정

| 파일 | 변경 |
|---|---|
| `src/shared/lib/db/schema.ts` | `hosts`/`projects`/`auditLogs` 3개 테이블 추가 |
| `src/shared/config/env.ts` | `ADMIN_EMAILS`/`DOCKER_DEFAULT_CONTEXT`/`DOCKER_CMD_TIMEOUT_MS` 추가 |
| `src/app/page.tsx` | `<ServerOverviewCard />` 마운트 (Suspense + ErrorBoundary) |
| `package.json` | `db:seed:hosts` 스크립트 추가 |
| `.env.example` | 새 환경 변수 3개 |
| `docs/RUNBOOK.md` | seed 절차 + dogfooding 체크리스트 |
| `TODOS.md` | v0.2 후보 추가 (L2 메트릭, Web Push, 다호스트 UI 등) |

---

## Task 1: DB 스키마 — `hosts`/`projects`/`audit_logs` 추가

**Files:**
- Modify: `src/shared/lib/db/schema.ts`
- Create: `drizzle/0002_server_infra.sql` (drizzle-kit 자동 생성)

- [ ] **Step 1: 스키마 파일 끝에 3개 테이블 추가**

`src/shared/lib/db/schema.ts` 파일 끝에 다음을 추가. 기존 `import` 블록의 `boolean`이 없으면 추가:

```typescript
// 기존 import 블록에 boolean 추가 (이미 있으면 skip)
import {
  pgTable, text, timestamp, integer, uuid, primaryKey, index, uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
```

스키마 파일 끝에 다음 블록 추가:

```typescript
/* =========================================================================
 * 서버 인프라 모니터 v0.1 — entities/host · entities/project · audit_logs
 * - hosts: 등록된 docker context (다호스트 확장 대비, v0.1엔 home-server 1대)
 * - projects: compose project 메타데이터 (display name, 카테고리, pinned)
 * - audit_logs: 컨테이너 액션 이력 (read+admin 기록)
 * ========================================================================= */
export const hosts = pgTable("hosts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // "home-server"
  dockerContext: text("docker_context").notNull(), // docker CLI --context 인자
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    composeProject: text("compose_project").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    category: text("category"), // 'news' | 'ai' | 'infra' | 'experiment' | null
    isPinned: boolean("is_pinned").notNull().default(false),
    isHidden: boolean("is_hidden").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_host_compose_idx").on(t.hostId, t.composeProject),
    index("projects_visible_idx").on(t.hostId, t.isHidden, t.isPinned),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id),
    containerId: text("container_id").notNull(),
    containerName: text("container_name").notNull(),
    action: text("action").notNull(), // 'restart' | 'start' | 'stop'
    userEmail: text("user_email").notNull(), // NextAuth session.user.email
    status: text("status").notNull(), // 'success' | 'failed'
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_recent_idx").on(t.createdAt.desc()),
    index("audit_logs_container_idx").on(t.containerId, t.createdAt.desc()),
  ],
);
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `drizzle/0002_server_infra.sql` (또는 0002_*.sql) 생성, `drizzle/meta/0002_snapshot.json` 추가.

- [ ] **Step 3: 마이그레이션 적용 (개발 DB)**

Run: `pnpm db:migrate`
Expected: `0002_*` applied, exit 0.

- [ ] **Step 4: 검증**

Run: `psql "$DATABASE_URL" -c "\dt" | grep -E "hosts|projects|audit_logs"`
Expected: 세 테이블이 모두 보임.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/db/schema.ts drizzle/
git commit -m "feat: 서버 인프라 v0.1 DB 스키마 (hosts/projects/audit_logs)"
```

---

## Task 2: 환경 변수 추가

**Files:**
- Modify: `src/shared/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: env.ts schema에 3개 키 추가**

`src/shared/config/env.ts`의 `schema` 객체 끝(`TZ` 이전)에 추가:

```typescript
  // ─── 서버 인프라 모니터 v0.1 ────────────────────────────
  // Docker context 이름 (사용자 입력 신뢰 안 함 — DB hosts.dockerContext만 사용,
  // 본 변수는 시작 시 health check 용도)
  DOCKER_DEFAULT_CONTEXT: z.string().min(1).default("home-server"),
  // Docker CLI 호출 타임아웃 (ms)
  DOCKER_CMD_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // restart/start/stop 액션 admin allowlist (콤마 구분 이메일)
  ADMIN_EMAILS: z.string().min(1),
```

- [ ] **Step 2: .env.example 갱신**

`.env.example` 끝에 추가:

```bash
# 서버 인프라 모니터 v0.1
DOCKER_DEFAULT_CONTEXT=home-server
DOCKER_CMD_TIMEOUT_MS=10000
ADMIN_EMAILS=krdn.net@gmail.com
```

- [ ] **Step 3: 부팅 검증**

`.env`에 `ADMIN_EMAILS=krdn.net@gmail.com` 추가했는지 확인 후:
Run: `pnpm typecheck`
Expected: 통과 (env 모듈 타입 추론에 문제 없음).

- [ ] **Step 4: Commit**

```bash
git add src/shared/config/env.ts .env.example
git commit -m "feat: 서버 인프라용 env 추가 (DOCKER_*, ADMIN_EMAILS)"
```

---

## Task 3: Seed 스크립트 — home-server 1대 등록

**Files:**
- Create: `src/scripts/seed-hosts.ts`
- Modify: `package.json`

- [ ] **Step 1: seed 스크립트 작성**

`src/scripts/seed-hosts.ts`:

```typescript
// home-server 호스트를 idempotent하게 upsert.
// 운영 배포 시 한 번만 돌리면 됨. 재실행해도 안전.
import { config } from "dotenv";
config({ path: ".env" });

import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db
    .insert(hosts)
    .values({
      name: "home-server",
      dockerContext: "home-server",
      description: "192.168.0.5 운영 서버 (Ubuntu 24.04, Docker Engine v27.5.1)",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: hosts.name,
      set: {
        dockerContext: sql`excluded.docker_context`,
        description: sql`excluded.description`,
        isActive: sql`excluded.is_active`,
      },
    })
    .returning({ id: hosts.id, name: hosts.name });

  console.log("✅ seeded host:", result[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: package.json scripts 추가**

`scripts` 객체에 추가:

```json
"db:seed:hosts": "tsx src/scripts/seed-hosts.ts"
```

(기존 `tsx` 사용 중인지 확인. 없으면 `node --import tsx` 형태로 대체.)

- [ ] **Step 3: 실행 검증**

Run: `pnpm db:seed:hosts`
Expected: `✅ seeded host: { id: '<uuid>', name: 'home-server' }`

재실행 시:
Run: `pnpm db:seed:hosts`
Expected: 같은 id 반환 (멱등).

- [ ] **Step 4: Commit**

```bash
git add src/scripts/seed-hosts.ts package.json
git commit -m "feat: home-server seed 스크립트 (idempotent)"
```

---

## Task 4: shared/lib/docker — `runDocker` execFile 어댑터

**Files:**
- Create: `src/shared/lib/docker/runDocker.ts`
- Test: `tests/docker-run.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/docker-run.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// execFile mock — 인자 캡처
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    opts: object,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    mockExecFile(file, args, opts);
    cb(null, "ok\n", "");
  },
}));

// 동적 import로 mock 적용 후 모듈 로드
let runDocker: typeof import("../src/shared/lib/docker/runDocker").runDocker;

beforeEach(async () => {
  mockExecFile.mockClear();
  ({ runDocker } = await import("../src/shared/lib/docker/runDocker"));
});

describe("runDocker", () => {
  it("docker CLI을 정확한 context와 args로 호출한다", async () => {
    const out = await runDocker("home-server", ["container", "ls"]);
    expect(out).toBe("ok\n");
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      ["--context", "home-server", "container", "ls"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("기본 timeout은 10초 (env 미설정 시)", async () => {
    delete process.env.DOCKER_CMD_TIMEOUT_MS;
    await runDocker("home-server", ["version"]);
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it("opts.timeoutMs가 우선한다", async () => {
    await runDocker("home-server", ["version"], { timeoutMs: 3_000 });
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.objectContaining({ timeout: 3_000 }),
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/docker-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현**

`src/shared/lib/docker/runDocker.ts`:

```typescript
// docker CLI을 execFile로 호출 (shell 보간 절대 금지).
// SSH 트랜스포트와 인증은 docker CLI의 --context가 처리.
import "server-only";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const runExecFile = promisify(execFileCb);

export type RunDockerOpts = {
  timeoutMs?: number;
};

export async function runDocker(
  context: string,
  args: string[],
  opts: RunDockerOpts = {},
): Promise<string> {
  const timeout =
    opts.timeoutMs ?? Number(process.env.DOCKER_CMD_TIMEOUT_MS ?? 10_000);
  const { stdout } = await runExecFile(
    "docker",
    ["--context", context, ...args],
    {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return stdout;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/docker-run.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/docker/runDocker.ts tests/docker-run.test.ts
git commit -m "feat: shared/lib/docker — runDocker execFile 어댑터 (TDD)"
```

---

## Task 5: shared/lib/docker — `parseContainer` (NDJSON line → Zod)

**Files:**
- Create: `src/shared/lib/docker/parseContainer.ts`
- Test: `tests/docker-parse-container.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/docker-parse-container.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseContainer } from "@/shared/lib/docker/parseContainer";

const HOST_ID = "11111111-1111-1111-1111-111111111111";

const SAMPLE = {
  ID: "abc123def456",
  Names: "news-prod-api",
  State: "running",
  Status: "Up 3 days",
  Image: "ghcr.io/krdn/news-api:latest",
  Ports: "0.0.0.0:8000->8000/tcp",
  Labels:
    "com.docker.compose.project=news-prod,com.docker.compose.service=api,maintainer=gon",
  CreatedAt: "2026-05-07 10:23:11 +0900 KST",
};

describe("parseContainer", () => {
  it("정상 입력을 ContainerSummary로 매핑한다", () => {
    const c = parseContainer(SAMPLE, HOST_ID);
    expect(c.id).toBe("abc123def456");
    expect(c.name).toBe("news-prod-api");
    expect(c.hostId).toBe(HOST_ID);
    expect(c.composeProject).toBe("news-prod");
    expect(c.composeService).toBe("api");
    expect(c.state).toBe("running");
    expect(c.statusText).toBe("Up 3 days");
    expect(c.image).toBe("ghcr.io/krdn/news-api:latest");
  });

  it("compose 라벨 없으면 composeProject/Service가 null", () => {
    const c = parseContainer(
      { ...SAMPLE, Labels: "maintainer=gon" },
      HOST_ID,
    );
    expect(c.composeProject).toBeNull();
    expect(c.composeService).toBeNull();
  });

  it("Labels가 빈 문자열이어도 안전하게 동작", () => {
    const c = parseContainer({ ...SAMPLE, Labels: "" }, HOST_ID);
    expect(c.composeProject).toBeNull();
  });

  it("Ports를 PortMapping[]으로 파싱", () => {
    const c = parseContainer(SAMPLE, HOST_ID);
    expect(c.ports).toEqual([
      { host: "0.0.0.0", hostPort: 8000, container: 8000, protocol: "tcp" },
    ]);
  });

  it("State가 enum 외 값이면 throw", () => {
    expect(() =>
      parseContainer({ ...SAMPLE, State: "zombie" }, HOST_ID),
    ).toThrow();
  });

  it("uptimeSeconds는 Status가 'Up Xd'면 추정, 아니면 null", () => {
    expect(parseContainer({ ...SAMPLE, Status: "Up 3 days" }, HOST_ID).uptimeSeconds)
      .toBe(3 * 86_400);
    expect(parseContainer({ ...SAMPLE, Status: "Exited (0) 5d ago" }, HOST_ID).uptimeSeconds)
      .toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/docker-parse-container.test.ts`
Expected: FAIL.

- [ ] **Step 3: 최소 구현**

`src/shared/lib/docker/parseContainer.ts`:

```typescript
import { z } from "zod";

const ContainerStateSchema = z.enum([
  "running",
  "exited",
  "restarting",
  "paused",
  "dead",
  "created",
]);
export type ContainerState = z.infer<typeof ContainerStateSchema>;

export type PortMapping = {
  host: string | null;
  hostPort: number | null;
  container: number;
  protocol: "tcp" | "udp";
};

export type ContainerSummary = {
  id: string;
  name: string;
  hostId: string;
  composeProject: string | null;
  composeService: string | null;
  state: ContainerState;
  statusText: string;
  uptimeSeconds: number | null;
  image: string;
  ports: PortMapping[];
  createdAt: string;
};

const RawContainerSchema = z.object({
  ID: z.string().min(1),
  Names: z.string().min(1),
  State: ContainerStateSchema,
  Status: z.string(),
  Image: z.string(),
  Ports: z.string(),
  Labels: z.string(),
  CreatedAt: z.string(),
});

function parseLabels(csv: string): Record<string, string> {
  if (!csv) return {};
  const out: Record<string, string> = {};
  for (const part of csv.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function parsePorts(s: string): PortMapping[] {
  if (!s) return [];
  // 예: "0.0.0.0:8000->8000/tcp, :::8000->8000/tcp"
  const out: PortMapping[] = [];
  for (const raw of s.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(
      /^(?:(?<host>[^:]+):)?(?<hostPort>\d+)?->?(?<container>\d+)\/(?<proto>tcp|udp)$/,
    );
    if (m && m.groups) {
      out.push({
        host: m.groups.host ?? null,
        hostPort: m.groups.hostPort ? Number(m.groups.hostPort) : null,
        container: Number(m.groups.container),
        protocol: m.groups.proto as "tcp" | "udp",
      });
      continue;
    }
    // exposed only: "8000/tcp"
    const m2 = part.match(/^(?<container>\d+)\/(?<proto>tcp|udp)$/);
    if (m2 && m2.groups) {
      out.push({
        host: null,
        hostPort: null,
        container: Number(m2.groups.container),
        protocol: m2.groups.proto as "tcp" | "udp",
      });
    }
  }
  return out;
}

function parseUptimeSeconds(status: string): number | null {
  // "Up 3 days", "Up 12 minutes", "Up 5 hours". Exited은 null.
  const m = status.match(/^Up\s+(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?)/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit.startsWith("second")) return n;
  if (unit.startsWith("minute")) return n * 60;
  if (unit.startsWith("hour")) return n * 3600;
  if (unit.startsWith("day")) return n * 86_400;
  if (unit.startsWith("week")) return n * 7 * 86_400;
  return null;
}

export function parseContainer(raw: unknown, hostId: string): ContainerSummary {
  const r = RawContainerSchema.parse(raw);
  const labels = parseLabels(r.Labels);
  return {
    id: r.ID,
    name: r.Names.split(",")[0].trim(),
    hostId,
    composeProject: labels["com.docker.compose.project"] ?? null,
    composeService: labels["com.docker.compose.service"] ?? null,
    state: r.State,
    statusText: r.Status,
    uptimeSeconds: parseUptimeSeconds(r.Status),
    image: r.Image,
    ports: parsePorts(r.Ports),
    createdAt: r.CreatedAt,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/docker-parse-container.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/docker/parseContainer.ts tests/docker-parse-container.test.ts
git commit -m "feat: parseContainer — Zod 기반 NDJSON line 파서 (TDD)"
```

---

## Task 6: shared/lib/docker — `listContainers` + `inspectContainer`

**Files:**
- Create: `src/shared/lib/docker/listContainers.ts`
- Create: `src/shared/lib/docker/inspectContainer.ts`
- Test: `tests/docker-list-containers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/docker-list-containers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunDocker = vi.fn();
vi.mock("@/shared/lib/docker/runDocker", () => ({
  runDocker: (ctx: string, args: string[]) => mockRunDocker(ctx, args),
}));

let listContainers: typeof import("@/shared/lib/docker/listContainers").listContainers;

const HOST_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(async () => {
  mockRunDocker.mockReset();
  ({ listContainers } = await import("@/shared/lib/docker/listContainers"));
});

const NDJSON_TWO = [
  JSON.stringify({
    ID: "abc",
    Names: "news-prod-api",
    State: "running",
    Status: "Up 3 days",
    Image: "img:1",
    Ports: "0.0.0.0:8000->8000/tcp",
    Labels: "com.docker.compose.project=news-prod,com.docker.compose.service=api",
    CreatedAt: "2026-05-07 10:23:11 +0900 KST",
  }),
  JSON.stringify({
    ID: "def",
    Names: "voice-api",
    State: "exited",
    Status: "Exited (0) 5d ago",
    Image: "img:2",
    Ports: "",
    Labels: "com.docker.compose.project=voice",
    CreatedAt: "2026-05-01 09:00:00 +0900 KST",
  }),
].join("\n") + "\n";

describe("listContainers", () => {
  it("--all --no-trunc --format json 으로 호출", async () => {
    mockRunDocker.mockResolvedValue("");
    await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(mockRunDocker).toHaveBeenCalledWith("home-server", [
      "container", "ls", "--all", "--no-trunc", "--format", "{{json .}}",
    ]);
  });

  it("NDJSON 두 줄을 두 개의 ContainerSummary로 매핑", async () => {
    mockRunDocker.mockResolvedValue(NDJSON_TWO);
    const list = await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("news-prod-api");
    expect(list[1].state).toBe("exited");
  });

  it("빈 출력은 빈 배열", async () => {
    mockRunDocker.mockResolvedValue("");
    const list = await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(list).toEqual([]);
  });

  it("malformed line 1개는 skip하고 warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRunDocker.mockResolvedValue("not-json\n" + NDJSON_TWO);
    const list = await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(list).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/docker-list-containers.test.ts`
Expected: FAIL.

- [ ] **Step 3: listContainers 구현**

`src/shared/lib/docker/listContainers.ts`:

```typescript
import "server-only";
import { runDocker } from "./runDocker";
import { parseContainer, type ContainerSummary } from "./parseContainer";

export type ListContainersInput = {
  context: string;
  hostId: string;
};

export async function listContainers(
  input: ListContainersInput,
): Promise<ContainerSummary[]> {
  const stdout = await runDocker(input.context, [
    "container",
    "ls",
    "--all",
    "--no-trunc",
    "--format",
    "{{json .}}",
  ]);
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const out: ContainerSummary[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line);
      out.push(parseContainer(raw, input.hostId));
    } catch (err) {
      console.warn("[docker.listContainers] skipped malformed line", {
        line: line.slice(0, 200),
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/docker-list-containers.test.ts`
Expected: 4 passed.

- [ ] **Step 5: inspectContainer 구현**

`src/shared/lib/docker/inspectContainer.ts`:

```typescript
import "server-only";
import { z } from "zod";
import { runDocker } from "./runDocker";
import { parseContainer, type ContainerSummary } from "./parseContainer";
import { maskEnv } from "./maskEnv";

export type ContainerInspect = ContainerSummary & {
  restartCount: number;
  imageDigest: string | null;
  mounts: Array<{ source: string; target: string; type: string }>;
  envMasked: Array<{ key: string; value: string | "***" }>;
  labels: Record<string, string>;
};

const InspectMountSchema = z.object({
  Type: z.string(),
  Source: z.string(),
  Destination: z.string(),
});

const InspectShape = z.object({
  Id: z.string(),
  Name: z.string(),
  State: z.object({
    Status: z.string(),
    Restarting: z.boolean().optional(),
  }),
  RestartCount: z.number().int().nonnegative(),
  Image: z.string(),
  Config: z.object({
    Image: z.string(),
    Env: z.array(z.string()).default([]),
    Labels: z.record(z.string(), z.string()).nullable().default({}),
  }),
  Mounts: z.array(InspectMountSchema).default([]),
});

export async function inspectContainer(
  context: string,
  containerId: string,
  base: ContainerSummary,
): Promise<ContainerInspect> {
  const stdout = await runDocker(context, ["inspect", containerId]);
  const arr = JSON.parse(stdout);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("docker inspect returned empty array");
  }
  const parsed = InspectShape.parse(arr[0]);
  const labels = parsed.Config.Labels ?? {};
  const mounts = parsed.Mounts.map((m) => ({
    source: m.Source,
    target: m.Destination,
    type: m.Type,
  }));
  const envMasked = parsed.Config.Env.map((line) => {
    const eq = line.indexOf("=");
    const key = eq > 0 ? line.slice(0, eq) : line;
    const value = eq > 0 ? line.slice(eq + 1) : "";
    return { key, value: maskEnv(key) ? "***" : value };
  });
  return {
    ...base,
    restartCount: parsed.RestartCount,
    imageDigest: parsed.Image.startsWith("sha256:") ? parsed.Image : null,
    mounts,
    envMasked,
    labels,
  };
}
```

(`maskEnv`는 다음 task에서 작성. 이 파일은 임시로 임포트 실패해도 OK — 다음 task에서 통과시킨다.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/lib/docker/listContainers.ts src/shared/lib/docker/inspectContainer.ts tests/docker-list-containers.test.ts
git commit -m "feat: docker.listContainers (TDD) + inspectContainer 골격"
```

---

## Task 7: shared/lib/docker — `maskEnv` + index export

**Files:**
- Create: `src/shared/lib/docker/maskEnv.ts`
- Create: `src/shared/lib/docker/index.ts`
- Test: `tests/docker-mask-env.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/docker-mask-env.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { maskEnv } from "@/shared/lib/docker/maskEnv";

describe("maskEnv", () => {
  it.each([
    ["ANTHROPIC_API_KEY", true],
    ["GITHUB_TOKEN", true],
    ["DB_PASSWORD", true],
    ["NEXTAUTH_SECRET", true],
    ["DATABASE_URL", true],
    ["AWS_SECRET_ACCESS_KEY", true],
  ])("민감 키 %s → 마스킹 true", (k, expected) => {
    expect(maskEnv(k)).toBe(expected);
  });

  it.each([
    ["NODE_ENV", false],
    ["PORT", false],
    ["TZ", false],
    ["LANG", false],
  ])("일반 키 %s → 마스킹 false", (k, expected) => {
    expect(maskEnv(k)).toBe(expected);
  });

  it("케이스 인센서티브", () => {
    expect(maskEnv("api_key")).toBe(true);
    expect(maskEnv("Api_Key")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/docker-mask-env.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/shared/lib/docker/maskEnv.ts`:

```typescript
// env 변수 키 이름이 민감 정보를 시사하면 true.
// 화이트리스트 키는 평문 노출 (NODE_ENV, PORT 등 운영자가 봐도 안전한 것).
const SENSITIVE_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PASSWD/i,
  /DSN/i,
  /URL$/i, // DATABASE_URL, REDIS_URL 등
  /CREDENTIAL/i,
  /PRIVATE/i,
];

const PLAINTEXT_WHITELIST = new Set([
  "NODE_ENV",
  "PORT",
  "TZ",
  "LANG",
  "PATH",
  "HOME",
  "PWD",
  "USER",
  "HOSTNAME",
]);

export function maskEnv(key: string): boolean {
  if (PLAINTEXT_WHITELIST.has(key.toUpperCase())) return false;
  return SENSITIVE_PATTERNS.some((re) => re.test(key));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/docker-mask-env.test.ts`
Expected: 모두 pass.

- [ ] **Step 5: index 작성**

`src/shared/lib/docker/index.ts`:

```typescript
export { runDocker } from "./runDocker";
export { listContainers } from "./listContainers";
export { inspectContainer } from "./inspectContainer";
export { parseContainer } from "./parseContainer";
export { maskEnv } from "./maskEnv";
export type {
  ContainerSummary,
  ContainerState,
  PortMapping,
} from "./parseContainer";
export type { ContainerInspect } from "./inspectContainer";
```

- [ ] **Step 6: 전체 docker 모듈 typecheck 통과 확인**

Run: `pnpm typecheck`
Expected: 통과.

- [ ] **Step 7: Commit**

```bash
git add src/shared/lib/docker/maskEnv.ts src/shared/lib/docker/index.ts tests/docker-mask-env.test.ts
git commit -m "feat: docker.maskEnv (TDD) + index export"
```

---

## Task 8: entities/host — model + api + ui

**Files:**
- Create: `src/entities/host/model/types.ts`
- Create: `src/entities/host/api/getHosts.ts`
- Create: `src/entities/host/api/getHostByName.ts`
- Create: `src/entities/host/ui/HostBadge.tsx`
- Create: `src/entities/host/index.ts`
- Test: `tests/host-api.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (PG 통합)**

`tests/host-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { getHosts } from "@/entities/host/api/getHosts";
import { getHostByName } from "@/entities/host/api/getHostByName";

describe("host api", () => {
  beforeEach(async () => {
    await db.delete(hosts);
  });

  it("getHosts: isActive만 반환, 이름 오름차순", async () => {
    await db.insert(hosts).values([
      { name: "z-host", dockerContext: "z", isActive: true },
      { name: "a-host", dockerContext: "a", isActive: true },
      { name: "inactive", dockerContext: "i", isActive: false },
    ]);
    const list = await getHosts();
    expect(list.map((h) => h.name)).toEqual(["a-host", "z-host"]);
  });

  it("getHostByName: 일치하는 호스트 반환", async () => {
    await db.insert(hosts).values({
      name: "home-server",
      dockerContext: "home-server",
      description: "192.168.0.5",
    });
    const h = await getHostByName("home-server");
    expect(h).not.toBeNull();
    expect(h!.dockerContext).toBe("home-server");
  });

  it("getHostByName: 없으면 null", async () => {
    const h = await getHostByName("nope");
    expect(h).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/host-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: types 작성**

`src/entities/host/model/types.ts`:

```typescript
export type Host = {
  id: string;
  name: string;
  dockerContext: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
};
```

- [ ] **Step 4: getHosts 구현**

`src/entities/host/api/getHosts.ts`:

```typescript
import "server-only";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import type { Host } from "../model/types";

export async function getHosts(): Promise<Host[]> {
  return db
    .select()
    .from(hosts)
    .where(eq(hosts.isActive, true))
    .orderBy(asc(hosts.name));
}
```

- [ ] **Step 5: getHostByName 구현**

`src/entities/host/api/getHostByName.ts`:

```typescript
import "server-only";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import type { Host } from "../model/types";

export async function getHostByName(name: string): Promise<Host | null> {
  const rows = await db.select().from(hosts).where(eq(hosts.name, name)).limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 6: HostBadge UI**

`src/entities/host/ui/HostBadge.tsx`:

```typescript
import type { Host } from "../model/types";

type Props = {
  host: Pick<Host, "name" | "description">;
  status?: "ok" | "warn" | "down";
};

export function HostBadge({ host, status = "ok" }: Props) {
  const dot =
    status === "ok"
      ? "bg-emerald-500"
      : status === "warn"
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="font-medium">{host.name}</span>
      {host.description ? (
        <span className="text-zinc-500">({host.description})</span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 7: index export**

`src/entities/host/index.ts`:

```typescript
export type { Host } from "./model/types";
export { getHosts } from "./api/getHosts";
export { getHostByName } from "./api/getHostByName";
export { HostBadge } from "./ui/HostBadge";
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm test tests/host-api.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Commit**

```bash
git add src/entities/host/ tests/host-api.test.ts
git commit -m "feat: entities/host — model + api + HostBadge (TDD)"
```

---

## Task 9: entities/project — model + api

**Files:**
- Create: `src/entities/project/model/types.ts`
- Create: `src/entities/project/api/getProjects.ts`
- Create: `src/entities/project/api/upsertProjectFromContainer.ts`
- Create: `src/entities/project/ui/ProjectCard.tsx`
- Create: `src/entities/project/index.ts`
- Test: `tests/project-api.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/project-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { hosts, projects } from "@/shared/lib/db/schema";
import { getProjects } from "@/entities/project/api/getProjects";
import { upsertProjectFromContainer } from "@/entities/project/api/upsertProjectFromContainer";

let hostId: string;

beforeEach(async () => {
  await db.delete(projects);
  await db.delete(hosts);
  const [h] = await db
    .insert(hosts)
    .values({ name: "home-server", dockerContext: "home-server" })
    .returning({ id: hosts.id });
  hostId = h.id;
});

describe("project api", () => {
  it("getProjects: hidden 제외, pinned 우선, 알파벳 정렬", async () => {
    await db.insert(projects).values([
      { hostId, composeProject: "z-app", displayName: "Z App" },
      { hostId, composeProject: "a-app", displayName: "A App" },
      { hostId, composeProject: "pinned", displayName: "Pinned", isPinned: true },
      { hostId, composeProject: "hidden", displayName: "Hidden", isHidden: true },
    ]);
    const list = await getProjects(hostId);
    expect(list.map((p) => p.composeProject)).toEqual(["pinned", "a-app", "z-app"]);
  });

  it("upsertProjectFromContainer: 신규는 생성", async () => {
    const p = await upsertProjectFromContainer({
      hostId,
      composeProject: "news-prod",
    });
    expect(p.displayName).toBe("news-prod"); // default = composeProject
    expect(p.hostId).toBe(hostId);
  });

  it("upsertProjectFromContainer: 기존은 update_at만 갱신, displayName 보존", async () => {
    await db.insert(projects).values({
      hostId,
      composeProject: "news-prod",
      displayName: "뉴스 서비스 (운영)",
    });
    const p = await upsertProjectFromContainer({
      hostId,
      composeProject: "news-prod",
    });
    expect(p.displayName).toBe("뉴스 서비스 (운영)"); // 사용자 설정 보존
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/project-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: types**

`src/entities/project/model/types.ts`:

```typescript
export type Project = {
  id: string;
  hostId: string;
  composeProject: string;
  displayName: string;
  description: string | null;
  category: string | null;
  isPinned: boolean;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 4: getProjects 구현**

`src/entities/project/api/getProjects.ts`:

```typescript
import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Project } from "../model/types";

export async function getProjects(hostId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.hostId, hostId), eq(projects.isHidden, false)))
    .orderBy(desc(projects.isPinned), asc(projects.composeProject));
}
```

- [ ] **Step 5: upsertProjectFromContainer 구현**

`src/entities/project/api/upsertProjectFromContainer.ts`:

```typescript
import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { sql } from "drizzle-orm";
import type { Project } from "../model/types";

export type UpsertInput = {
  hostId: string;
  composeProject: string;
};

export async function upsertProjectFromContainer(
  input: UpsertInput,
): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({
      hostId: input.hostId,
      composeProject: input.composeProject,
      displayName: input.composeProject, // default; 사용자가 나중에 수정
    })
    .onConflictDoUpdate({
      target: [projects.hostId, projects.composeProject],
      set: { updatedAt: sql`now()` }, // displayName/category/isPinned는 보존
    })
    .returning();
  return row;
}
```

- [ ] **Step 6: ProjectCard UI**

`src/entities/project/ui/ProjectCard.tsx`:

```typescript
import type { Project } from "../model/types";

type Props = {
  project: Pick<Project, "displayName" | "description" | "isPinned" | "composeProject">;
  totalContainers: number;
  runningContainers: number;
  warningCount: number;
  children?: React.ReactNode;
};

export function ProjectCard({
  project,
  totalContainers,
  runningContainers,
  warningCount,
  children,
}: Props) {
  const allHealthy = warningCount === 0 && runningContainers === totalContainers;
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            {project.isPinned ? "📌 " : ""}
            {project.displayName}
          </h2>
          {project.description ? (
            <p className="text-sm text-zinc-500">{project.description}</p>
          ) : null}
        </div>
        <div className="text-sm">
          {allHealthy ? "✓" : "⚠"} {runningContainers}/{totalContainers} running
        </div>
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}
```

- [ ] **Step 7: index**

`src/entities/project/index.ts`:

```typescript
export type { Project } from "./model/types";
export { getProjects } from "./api/getProjects";
export { upsertProjectFromContainer } from "./api/upsertProjectFromContainer";
export { ProjectCard } from "./ui/ProjectCard";
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm test tests/project-api.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Commit**

```bash
git add src/entities/project/ tests/project-api.test.ts
git commit -m "feat: entities/project — getProjects + upsert + ProjectCard (TDD)"
```

---

## Task 10: entities/container — api wrapper + UI

**Files:**
- Create: `src/entities/container/model/types.ts`
- Create: `src/entities/container/api/listContainers.ts`
- Create: `src/entities/container/api/inspectContainer.ts`
- Create: `src/entities/container/ui/ContainerStatusBadge.tsx`
- Create: `src/entities/container/ui/ContainerRow.tsx`
- Create: `src/entities/container/index.ts`

(여기는 shared/lib/docker를 얇게 래핑만. 새 PG 테스트 없음.)

- [ ] **Step 1: types re-export**

`src/entities/container/model/types.ts`:

```typescript
export type {
  ContainerSummary,
  ContainerInspect,
  ContainerState,
  PortMapping,
} from "@/shared/lib/docker";
```

- [ ] **Step 2: listContainers wrapper**

`src/entities/container/api/listContainers.ts`:

```typescript
import "server-only";
import { listContainers as dockerList } from "@/shared/lib/docker";
import type { ContainerSummary } from "../model/types";

export type ListInput = {
  hostId: string;
  dockerContext: string;
};

export async function listContainers(input: ListInput): Promise<ContainerSummary[]> {
  return dockerList({ context: input.dockerContext, hostId: input.hostId });
}
```

- [ ] **Step 3: inspectContainer wrapper**

`src/entities/container/api/inspectContainer.ts`:

```typescript
import "server-only";
import {
  inspectContainer as dockerInspect,
  listContainers as dockerList,
} from "@/shared/lib/docker";
import type { ContainerInspect } from "../model/types";

export type InspectInput = {
  hostId: string;
  dockerContext: string;
  containerId: string;
};

export async function inspectContainer(input: InspectInput): Promise<ContainerInspect> {
  // 먼저 list에서 base를 찾는다 (한번에 statusText/uptimeSeconds 취득). 없으면 throw.
  const all = await dockerList({
    context: input.dockerContext,
    hostId: input.hostId,
  });
  const base = all.find((c) => c.id === input.containerId);
  if (!base) {
    throw new Error(`container not found: ${input.containerId}`);
  }
  return dockerInspect(input.dockerContext, input.containerId, base);
}
```

- [ ] **Step 4: ContainerStatusBadge**

`src/entities/container/ui/ContainerStatusBadge.tsx`:

```typescript
import type { ContainerState } from "../model/types";

const STYLE: Record<ContainerState, { bg: string; label: string }> = {
  running: { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", label: "running" },
  exited: { bg: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300", label: "exited" },
  restarting: { bg: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", label: "restarting" },
  paused: { bg: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", label: "paused" },
  dead: { bg: "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-200", label: "dead" },
  created: { bg: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300", label: "created" },
};

export function ContainerStatusBadge({ state }: { state: ContainerState }) {
  const s = STYLE[state];
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${s.bg}`}>
      {s.label}
    </span>
  );
}
```

- [ ] **Step 5: ContainerRow**

`src/entities/container/ui/ContainerRow.tsx`:

```typescript
import type { ContainerSummary } from "../model/types";
import { ContainerStatusBadge } from "./ContainerStatusBadge";

type Props = {
  container: ContainerSummary;
  actions?: React.ReactNode;
};

export function ContainerRow({ container, actions }: Props) {
  const portsText = container.ports
    .filter((p) => p.hostPort != null)
    .map((p) => `:${p.hostPort}`)
    .join(" ");
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <ContainerStatusBadge state={container.state} />
        <span className="truncate font-mono">{container.name}</span>
        <span className="text-zinc-500 truncate">{container.statusText}</span>
        {portsText ? <span className="text-zinc-400">{portsText}</span> : null}
      </div>
      {actions}
    </div>
  );
}
```

- [ ] **Step 6: index**

`src/entities/container/index.ts`:

```typescript
export type {
  ContainerSummary,
  ContainerInspect,
  ContainerState,
  PortMapping,
} from "./model/types";
export { listContainers } from "./api/listContainers";
export { inspectContainer } from "./api/inspectContainer";
export { ContainerStatusBadge } from "./ui/ContainerStatusBadge";
export { ContainerRow } from "./ui/ContainerRow";
```

- [ ] **Step 7: typecheck**

Run: `pnpm typecheck`
Expected: 통과.

- [ ] **Step 8: Commit**

```bash
git add src/entities/container/
git commit -m "feat: entities/container — listContainers/inspect 래퍼 + Badge/Row"
```

---

## Task 11: features/container-list — `groupByProject` pure function

**Files:**
- Create: `src/features/container-list/lib/groupByProject.ts`
- Test: `tests/container-list-group-by-project.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/container-list-group-by-project.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { groupByProject } from "@/features/container-list/lib/groupByProject";
import type { ContainerSummary } from "@/entities/container";
import type { Project } from "@/entities/project";

const HOST_ID = "h1";
const NOW = new Date("2026-05-10T00:00:00Z");

function c(overrides: Partial<ContainerSummary>): ContainerSummary {
  return {
    id: "id",
    name: "name",
    hostId: HOST_ID,
    composeProject: null,
    composeService: null,
    state: "running",
    statusText: "Up 1 day",
    uptimeSeconds: 86_400,
    image: "img",
    ports: [],
    createdAt: "",
    ...overrides,
  };
}

function p(overrides: Partial<Project>): Project {
  return {
    id: "p",
    hostId: HOST_ID,
    composeProject: "x",
    displayName: "x",
    description: null,
    category: null,
    isPinned: false,
    isHidden: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("groupByProject", () => {
  it("compose 라벨로 그룹화 + project 메타 join", () => {
    const containers = [
      c({ id: "1", name: "news-api", composeProject: "news-prod" }),
      c({ id: "2", name: "news-app", composeProject: "news-prod" }),
      c({ id: "3", name: "voice-api", composeProject: "voice", state: "exited" }),
    ];
    const projects = [
      p({ id: "p1", composeProject: "news-prod", displayName: "뉴스" }),
      p({ id: "p2", composeProject: "voice", displayName: "음성" }),
    ];
    const groups = groupByProject(containers, projects);
    expect(groups).toHaveLength(2);
    const news = groups.find((g) => g.composeProject === "news-prod")!;
    expect(news.displayName).toBe("뉴스");
    expect(news.containers).toHaveLength(2);
    expect(news.runningCount).toBe(2);
    expect(news.warningCount).toBe(0);

    const voice = groups.find((g) => g.composeProject === "voice")!;
    expect(voice.warningCount).toBe(1);
  });

  it("라벨 없는 컨테이너는 standalone 가상 그룹", () => {
    const groups = groupByProject(
      [c({ id: "1", name: "open-webui", composeProject: null })],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].composeProject).toBe("standalone");
    expect(groups[0].isStandalone).toBe(true);
  });

  it("hidden project는 그룹 누락", () => {
    const containers = [
      c({ id: "1", composeProject: "noisy" }),
      c({ id: "2", composeProject: "news-prod" }),
    ];
    const projects = [
      p({ composeProject: "noisy", isHidden: true }),
      p({ composeProject: "news-prod" }),
    ];
    const groups = groupByProject(containers, projects);
    expect(groups.map((g) => g.composeProject)).toEqual(["news-prod"]);
  });

  it("pinned 우선, 그 다음 알파벳 순, standalone은 마지막", () => {
    const containers = [
      c({ id: "1", composeProject: "z-proj" }),
      c({ id: "2", composeProject: "a-proj" }),
      c({ id: "3", composeProject: "pinned" }),
      c({ id: "4", composeProject: null }),
    ];
    const projects = [
      p({ composeProject: "z-proj" }),
      p({ composeProject: "a-proj" }),
      p({ composeProject: "pinned", isPinned: true }),
    ];
    const groups = groupByProject(containers, projects);
    expect(groups.map((g) => g.composeProject)).toEqual([
      "pinned",
      "a-proj",
      "z-proj",
      "standalone",
    ]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/container-list-group-by-project.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/features/container-list/lib/groupByProject.ts`:

```typescript
import type { ContainerSummary, ContainerState } from "@/entities/container";
import type { Project } from "@/entities/project";

export type ProjectGroup = {
  composeProject: string;
  displayName: string;
  description: string | null;
  isPinned: boolean;
  isStandalone: boolean;
  containers: ContainerSummary[];
  runningCount: number;
  totalCount: number;
  warningCount: number; // exited|restarting|dead|paused 카운트
};

const WARNING_STATES: ReadonlySet<ContainerState> = new Set([
  "exited",
  "restarting",
  "dead",
  "paused",
]);

const STANDALONE = "standalone";

function makeGroup(
  composeProject: string,
  displayName: string,
  description: string | null,
  isPinned: boolean,
  isStandalone: boolean,
  containers: ContainerSummary[],
): ProjectGroup {
  let running = 0;
  let warning = 0;
  for (const c of containers) {
    if (c.state === "running") running++;
    if (WARNING_STATES.has(c.state)) warning++;
  }
  return {
    composeProject,
    displayName,
    description,
    isPinned,
    isStandalone,
    containers,
    runningCount: running,
    totalCount: containers.length,
    warningCount: warning,
  };
}

export function groupByProject(
  containers: ContainerSummary[],
  projects: Project[],
): ProjectGroup[] {
  const projectByCompose = new Map(projects.map((p) => [p.composeProject, p]));
  const hiddenSet = new Set(
    projects.filter((p) => p.isHidden).map((p) => p.composeProject),
  );

  const buckets = new Map<string, ContainerSummary[]>();
  for (const c of containers) {
    if (c.composeProject == null) {
      const arr = buckets.get(STANDALONE) ?? [];
      arr.push(c);
      buckets.set(STANDALONE, arr);
      continue;
    }
    if (hiddenSet.has(c.composeProject)) continue;
    const arr = buckets.get(c.composeProject) ?? [];
    arr.push(c);
    buckets.set(c.composeProject, arr);
  }

  const groups: ProjectGroup[] = [];
  for (const [key, list] of buckets) {
    if (key === STANDALONE) {
      groups.push(makeGroup(STANDALONE, "standalone", null, false, true, list));
      continue;
    }
    const meta = projectByCompose.get(key);
    groups.push(
      makeGroup(
        key,
        meta?.displayName ?? key,
        meta?.description ?? null,
        meta?.isPinned ?? false,
        false,
        list,
      ),
    );
  }

  return groups.sort((a, b) => {
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.composeProject.localeCompare(b.composeProject);
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/container-list-group-by-project.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/container-list/lib/ tests/container-list-group-by-project.test.ts
git commit -m "feat: container-list/groupByProject — pure function (TDD)"
```

---

## Task 12: features/container-list — UI sections + index

**Files:**
- Create: `src/features/container-list/ui/ProjectGroupSection.tsx`
- Create: `src/features/container-list/ui/StandaloneSection.tsx`
- Create: `src/features/container-list/index.ts`

- [ ] **Step 1: ProjectGroupSection 작성**

`src/features/container-list/ui/ProjectGroupSection.tsx`:

```typescript
import { ContainerRow } from "@/entities/container";
import { ProjectCard } from "@/entities/project";
import type { ProjectGroup } from "../lib/groupByProject";

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
      }}
      totalContainers={group.totalCount}
      runningContainers={group.runningCount}
      warningCount={group.warningCount}
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {group.containers.map((c) => (
          <li key={c.id}>
            <ContainerRow
              container={c}
              actions={renderActions ? renderActions(c.id, c.name) : null}
            />
          </li>
        ))}
      </ul>
    </ProjectCard>
  );
}
```

- [ ] **Step 2: StandaloneSection 작성**

`src/features/container-list/ui/StandaloneSection.tsx`:

```typescript
import { ContainerRow } from "@/entities/container";
import type { ProjectGroup } from "../lib/groupByProject";

type Props = {
  group: ProjectGroup;
  renderActions?: (containerId: string, containerName: string) => React.ReactNode;
};

export function StandaloneSection({ group, renderActions }: Props) {
  if (group.containers.length === 0) return null;
  return (
    <section className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
          standalone (compose 라벨 없음)
        </h2>
        <span className="text-xs text-zinc-500">
          {group.runningCount}/{group.totalCount} running
        </span>
      </header>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {group.containers.map((c) => (
          <li key={c.id}>
            <ContainerRow
              container={c}
              actions={renderActions ? renderActions(c.id, c.name) : null}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: index 작성**

`src/features/container-list/index.ts`:

```typescript
export { groupByProject } from "./lib/groupByProject";
export type { ProjectGroup } from "./lib/groupByProject";
export { ProjectGroupSection } from "./ui/ProjectGroupSection";
export { StandaloneSection } from "./ui/StandaloneSection";
```

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: 통과.

- [ ] **Step 5: Commit**

```bash
git add src/features/container-list/
git commit -m "feat: container-list — ProjectGroupSection + Standalone + index"
```

---

## Task 13: features/container-actions — `isAdmin` + audit helper

**Files:**
- Create: `src/features/container-actions/lib/isAdmin.ts`
- Create: `src/features/container-actions/api/insertAuditLog.ts`
- Test: `tests/container-actions-admin.test.ts`

- [ ] **Step 1: isAdmin 테스트**

`tests/container-actions-admin.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isAdmin } from "@/features/container-actions/lib/isAdmin";

describe("isAdmin", () => {
  it("ADMIN_EMAILS에 정확히 매칭되면 true", () => {
    expect(isAdmin("krdn.net@gmail.com", "krdn.net@gmail.com,other@example.com")).toBe(true);
    expect(isAdmin("other@example.com", "krdn.net@gmail.com,other@example.com")).toBe(true);
  });

  it("매칭 안 되면 false", () => {
    expect(isAdmin("intruder@example.com", "krdn.net@gmail.com")).toBe(false);
  });

  it("email이 null이면 false", () => {
    expect(isAdmin(null, "krdn.net@gmail.com")).toBe(false);
    expect(isAdmin(undefined, "krdn.net@gmail.com")).toBe(false);
  });

  it("화이트스페이스 trim", () => {
    expect(isAdmin("a@b.com", " a@b.com , c@d.com ")).toBe(true);
  });

  it("케이스 인센서티브", () => {
    expect(isAdmin("Krdn.NET@gmail.com", "krdn.net@gmail.com")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/container-actions-admin.test.ts`
Expected: FAIL.

- [ ] **Step 3: isAdmin 구현**

`src/features/container-actions/lib/isAdmin.ts`:

```typescript
export function isAdmin(
  email: string | null | undefined,
  allowlistCsv: string,
): boolean {
  if (!email) return false;
  const target = email.trim().toLowerCase();
  if (!target) return false;
  for (const raw of allowlistCsv.split(",")) {
    if (raw.trim().toLowerCase() === target) return true;
  }
  return false;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test tests/container-actions-admin.test.ts`
Expected: 5 passed.

- [ ] **Step 5: insertAuditLog 헬퍼**

`src/features/container-actions/api/insertAuditLog.ts`:

```typescript
import "server-only";
import { db } from "@/shared/lib/db/client";
import { auditLogs } from "@/shared/lib/db/schema";

export type AuditInput = {
  hostId: string;
  containerId: string;
  containerName: string;
  action: "restart" | "start" | "stop";
  userEmail: string;
  status: "success" | "failed";
  errorMessage?: string | null;
  durationMs: number;
};

export async function insertAuditLog(input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    hostId: input.hostId,
    containerId: input.containerId,
    containerName: input.containerName,
    action: input.action,
    userEmail: input.userEmail,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    durationMs: input.durationMs,
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/features/container-actions/lib/ src/features/container-actions/api/insertAuditLog.ts tests/container-actions-admin.test.ts
git commit -m "feat: container-actions/isAdmin (TDD) + insertAuditLog helper"
```

---

## Task 14: features/container-actions — Server Actions (restart/start/stop)

**Files:**
- Create: `src/features/container-actions/api/restartContainer.ts`
- Create: `src/features/container-actions/api/startContainer.ts`
- Create: `src/features/container-actions/api/stopContainer.ts`
- Test: `tests/container-actions.test.ts`

- [ ] **Step 1: 통합 테스트 작성**

`tests/container-actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { hosts, auditLogs } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";

const mockAuth = vi.fn();
vi.mock("@/shared/lib/auth", () => ({
  auth: () => mockAuth(),
}));

const mockRunDocker = vi.fn();
vi.mock("@/shared/lib/docker", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/docker")>(
    "@/shared/lib/docker",
  );
  return { ...actual, runDocker: (...a: unknown[]) => mockRunDocker(...a) };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const VALID_ID = "a".repeat(64);

let hostId: string;

beforeEach(async () => {
  await db.delete(auditLogs);
  await db.delete(hosts);
  const [h] = await db
    .insert(hosts)
    .values({ name: "home-server", dockerContext: "home-server" })
    .returning({ id: hosts.id });
  hostId = h.id;
  mockAuth.mockReset();
  mockRunDocker.mockReset();
  process.env.ADMIN_EMAILS = "krdn.net@gmail.com";
});

async function loadAction(name: "restart" | "start" | "stop") {
  const mod = await import(
    `@/features/container-actions/api/${name}Container`
  );
  return (mod as Record<string, (i: unknown) => Promise<unknown>>)[
    `${name}Container`
  ];
}

describe("container-actions", () => {
  it("admin이 restart 호출 → docker CLI 호출 + audit success 기록", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    mockRunDocker.mockResolvedValue("");
    const restart = await loadAction("restart");

    const result = await restart({
      hostId,
      containerId: VALID_ID,
      containerName: "news-api",
    });

    expect(result).toMatchObject({ ok: true });
    expect(mockRunDocker).toHaveBeenCalledWith("home-server", [
      "restart", VALID_ID,
    ], expect.any(Object));
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.hostId, hostId));
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("restart");
    expect(logs[0].status).toBe("success");
  });

  it("비admin은 거부 + audit 기록 없음", async () => {
    mockAuth.mockResolvedValue({ user: { email: "intruder@example.com" } });
    const restart = await loadAction("restart");

    const result = await restart({
      hostId,
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(mockRunDocker).not.toHaveBeenCalled();
    const logs = await db.select().from(auditLogs);
    expect(logs).toHaveLength(0);
  });

  it("docker 실패 시 status=failed 기록 + ok:false", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    mockRunDocker.mockRejectedValue(new Error("docker daemon down"));
    const stop = await loadAction("stop");
    const result = await stop({
      hostId,
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "DOCKER_ERROR" });
    const logs = await db.select().from(auditLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("failed");
    expect(logs[0].errorMessage).toContain("docker daemon down");
  });

  it("invalid containerId (non-hex) → ok:false, docker 호출 없음", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    const restart = await loadAction("restart");
    const result = await restart({
      hostId,
      containerId: "../../../etc/passwd",
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(mockRunDocker).not.toHaveBeenCalled();
  });

  it("unknown hostId → ok:false", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    const start = await loadAction("start");
    const result = await start({
      hostId: "00000000-0000-0000-0000-000000000000",
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "HOST_NOT_FOUND" });
  });

  it("세션 없으면 ok:false UNAUTHORIZED", async () => {
    mockAuth.mockResolvedValue(null);
    const restart = await loadAction("restart");
    const result = await restart({
      hostId,
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test tests/container-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: 공유 헬퍼 — runActionGuarded**

3개 액션이 같은 골격을 가지므로 작은 헬퍼로 분리.

`src/features/container-actions/api/_runAction.ts`:

```typescript
import "server-only";
import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { runDocker } from "@/shared/lib/docker";
import { revalidatePath } from "next/cache";
import { isAdmin } from "../lib/isAdmin";
import { insertAuditLog } from "./insertAuditLog";

export const ActionInput = z.object({
  hostId: z.string().uuid(),
  containerId: z.string().regex(/^[a-f0-9]{12,64}$/),
  containerName: z.string().min(1).max(200),
});

export type ActionInputT = z.infer<typeof ActionInput>;

export type ActionResult =
  | { ok: true }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_INPUT" | "HOST_NOT_FOUND" | "DOCKER_ERROR"; message?: string };

export async function runAction(
  action: "restart" | "start" | "stop",
  rawInput: unknown,
): Promise<ActionResult> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!email) return { ok: false, code: "UNAUTHORIZED" };
  if (!isAdmin(email, process.env.ADMIN_EMAILS ?? "")) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const parsed = ActionInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  const [host] = await db
    .select()
    .from(hosts)
    .where(eq(hosts.id, input.hostId))
    .limit(1);
  if (!host) return { ok: false, code: "HOST_NOT_FOUND" };

  const start = Date.now();
  try {
    await runDocker(host.dockerContext, [action, input.containerId]);
    const durationMs = Date.now() - start;
    await insertAuditLog({
      hostId: host.id,
      containerId: input.containerId,
      containerName: input.containerName,
      action,
      userEmail: email,
      status: "success",
      durationMs,
    });
    revalidatePath(`/servers/${host.name}`);
    return { ok: true };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    await insertAuditLog({
      hostId: host.id,
      containerId: input.containerId,
      containerName: input.containerName,
      action,
      userEmail: email,
      status: "failed",
      errorMessage: message.slice(0, 500),
      durationMs,
    });
    return { ok: false, code: "DOCKER_ERROR", message };
  }
}
```

- [ ] **Step 4: 3개 Server Action 작성**

`src/features/container-actions/api/restartContainer.ts`:

```typescript
"use server";
import { runAction, type ActionInputT, type ActionResult } from "./_runAction";

export async function restartContainer(input: ActionInputT): Promise<ActionResult> {
  return runAction("restart", input);
}
```

`src/features/container-actions/api/startContainer.ts`:

```typescript
"use server";
import { runAction, type ActionInputT, type ActionResult } from "./_runAction";

export async function startContainer(input: ActionInputT): Promise<ActionResult> {
  return runAction("start", input);
}
```

`src/features/container-actions/api/stopContainer.ts`:

```typescript
"use server";
import { runAction, type ActionInputT, type ActionResult } from "./_runAction";

export async function stopContainer(input: ActionInputT): Promise<ActionResult> {
  return runAction("stop", input);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test tests/container-actions.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/features/container-actions/api/ tests/container-actions.test.ts
git commit -m "feat: container-actions Server Actions — restart/start/stop + audit (TDD)"
```

---

## Task 15: features/container-actions — UI (ActionButtons + AuditLogPanel) + index

**Files:**
- Create: `src/features/container-actions/ui/ActionButtons.tsx`
- Create: `src/features/container-actions/ui/AuditLogPanel.tsx`
- Create: `src/features/container-actions/index.ts`

- [ ] **Step 1: ActionButtons 작성 (client)**

`src/features/container-actions/ui/ActionButtons.tsx`:

```typescript
"use client";
import { useState, useTransition } from "react";
import { restartContainer } from "../api/restartContainer";
import { startContainer } from "../api/startContainer";
import { stopContainer } from "../api/stopContainer";
import type { ContainerState } from "@/entities/container";

type Props = {
  hostId: string;
  containerId: string;
  containerName: string;
  state: ContainerState;
  isAdmin: boolean;
};

const ACTION_FN = {
  restart: restartContainer,
  start: startContainer,
  stop: stopContainer,
} as const;

export function ActionButtons({
  hostId,
  containerId,
  containerName,
  state,
  isAdmin,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!isAdmin) return null;

  function run(action: "restart" | "start" | "stop") {
    const ok = window.confirm(`정말 ${containerName}를 ${action} 할까요?`);
    if (!ok) return;
    startTransition(async () => {
      setMessage(null);
      const result = await ACTION_FN[action]({ hostId, containerId, containerName });
      if (result.ok) {
        setMessage(`✓ ${action} 성공`);
      } else {
        setMessage(`✕ ${action} 실패 (${result.code})`);
      }
    });
  }

  const canStart = state !== "running" && state !== "restarting";
  const canStop = state === "running" || state === "restarting";

  return (
    <div className="flex items-center gap-1 text-xs">
      {canStart ? (
        <button
          onClick={() => run("start")}
          disabled={pending}
          className="rounded border px-2 py-0.5 hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
        >
          ▶ start
        </button>
      ) : null}
      {state === "running" ? (
        <button
          onClick={() => run("restart")}
          disabled={pending}
          className="rounded border px-2 py-0.5 hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
        >
          ⟳ restart
        </button>
      ) : null}
      {canStop ? (
        <button
          onClick={() => run("stop")}
          disabled={pending}
          className="rounded border px-2 py-0.5 hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
        >
          ⏸ stop
        </button>
      ) : null}
      {message ? <span className="ml-2 text-zinc-500">{message}</span> : null}
    </div>
  );
}
```

- [ ] **Step 2: AuditLogPanel 작성 (RSC)**

`src/features/container-actions/ui/AuditLogPanel.tsx`:

```typescript
import "server-only";
import { db } from "@/shared/lib/db/client";
import { auditLogs } from "@/shared/lib/db/schema";
import { desc, eq } from "drizzle-orm";

type Props = { hostId: string; limit?: number };

export async function AuditLogPanel({ hostId, limit = 5 }: Props) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.hostId, hostId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">아직 액션 기록이 없습니다.</p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2 font-mono">
          <time className="text-zinc-500">
            {new Date(r.createdAt).toLocaleString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              month: "2-digit",
              day: "2-digit",
            })}
          </time>
          <span
            className={
              r.status === "success"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-700 dark:text-rose-400"
            }
          >
            {r.action}
          </span>
          <span className="truncate">{r.containerName}</span>
          <span className="text-zinc-500">({r.userEmail})</span>
          {r.errorMessage ? (
            <span className="truncate text-rose-500">{r.errorMessage}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: index 작성**

`src/features/container-actions/index.ts`:

```typescript
export { restartContainer } from "./api/restartContainer";
export { startContainer } from "./api/startContainer";
export { stopContainer } from "./api/stopContainer";
export { isAdmin } from "./lib/isAdmin";
export { ActionButtons } from "./ui/ActionButtons";
export { AuditLogPanel } from "./ui/AuditLogPanel";
```

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: 통과.

- [ ] **Step 5: Commit**

```bash
git add src/features/container-actions/ui/ src/features/container-actions/index.ts
git commit -m "feat: container-actions UI — ActionButtons + AuditLogPanel"
```

---

## Task 16: features/host-catalog — getHostsWithSummary

**Files:**
- Create: `src/features/host-catalog/api/getHostsWithSummary.ts`
- Create: `src/features/host-catalog/index.ts`

- [ ] **Step 1: getHostsWithSummary 작성**

`src/features/host-catalog/api/getHostsWithSummary.ts`:

```typescript
import "server-only";
import { getHosts, type Host } from "@/entities/host";
import { listContainers } from "@/entities/container";
import {
  getProjects,
  upsertProjectFromContainer,
  type Project,
} from "@/entities/project";
import { groupByProject, type ProjectGroup } from "@/features/container-list";

export type HostSummary = {
  host: Host;
  groups: ProjectGroup[];
  daemonOk: boolean;
  errorMessage: string | null;
  fetchedAt: string;
};

export async function getHostsWithSummary(): Promise<HostSummary[]> {
  const hosts = await getHosts();
  const summaries = await Promise.all(
    hosts.map(async (host): Promise<HostSummary> => {
      try {
        const [containers, projects] = await Promise.all([
          listContainers({ hostId: host.id, dockerContext: host.dockerContext }),
          getProjects(host.id),
        ]);
        // 라이브에서 새로 발견한 compose project를 lazy upsert
        const knownComposeKeys = new Set(projects.map((p) => p.composeProject));
        const unknown = Array.from(
          new Set(
            containers
              .map((c) => c.composeProject)
              .filter((k): k is string => k != null && !knownComposeKeys.has(k)),
          ),
        );
        let upsertedProjects: Project[] = projects;
        if (unknown.length > 0) {
          const created = await Promise.all(
            unknown.map((composeProject) =>
              upsertProjectFromContainer({ hostId: host.id, composeProject }),
            ),
          );
          upsertedProjects = [...projects, ...created];
        }
        return {
          host,
          groups: groupByProject(containers, upsertedProjects),
          daemonOk: true,
          errorMessage: null,
          fetchedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          host,
          groups: [],
          daemonOk: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          fetchedAt: new Date().toISOString(),
        };
      }
    }),
  );
  return summaries;
}
```

- [ ] **Step 2: index**

`src/features/host-catalog/index.ts`:

```typescript
export { getHostsWithSummary } from "./api/getHostsWithSummary";
export type { HostSummary } from "./api/getHostsWithSummary";
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 통과.

- [ ] **Step 4: Commit**

```bash
git add src/features/host-catalog/
git commit -m "feat: host-catalog — getHostsWithSummary (lazy project upsert)"
```

---

## Task 17: widgets/server-overview — RSC 카드 + skeleton + error

**Files:**
- Create: `src/widgets/server-overview/ui/ServerOverviewCard.tsx`
- Create: `src/widgets/server-overview/ui/ServerOverviewSkeleton.tsx`
- Create: `src/widgets/server-overview/ui/ServerOverviewError.tsx`
- Create: `src/widgets/server-overview/index.ts`

- [ ] **Step 1: Skeleton**

`src/widgets/server-overview/ui/ServerOverviewSkeleton.tsx`:

```typescript
export function ServerOverviewSkeleton() {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-4 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Error fallback**

`src/widgets/server-overview/ui/ServerOverviewError.tsx`:

```typescript
type Props = { hostName: string; message: string; fetchedAt: string };

export function ServerOverviewError({ hostName, message, fetchedAt }: Props) {
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950">
      <p className="font-semibold text-rose-800 dark:text-rose-300">
        🖥 {hostName} — Docker 연결 불가
      </p>
      <p className="mt-1 text-rose-700 dark:text-rose-400 break-all">{message}</p>
      <p className="mt-2 text-xs text-rose-600 dark:text-rose-500">
        마지막 시도: {new Date(fetchedAt).toLocaleString("ko-KR")}
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Card RSC**

`src/widgets/server-overview/ui/ServerOverviewCard.tsx`:

```typescript
import "server-only";
import Link from "next/link";
import { getHostsWithSummary } from "@/features/host-catalog";
import { HostBadge } from "@/entities/host";
import { ServerOverviewError } from "./ServerOverviewError";

export async function ServerOverviewCard() {
  const summaries = await getHostsWithSummary();
  if (summaries.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">
          등록된 호스트가 없습니다. <code>pnpm db:seed:hosts</code>를 실행하세요.
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-3">
      {summaries.map((s) =>
        !s.daemonOk ? (
          <ServerOverviewError
            key={s.host.id}
            hostName={s.host.name}
            message={s.errorMessage ?? "unknown"}
            fetchedAt={s.fetchedAt}
          />
        ) : (
          <section
            key={s.host.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <header className="mb-3 flex items-center justify-between">
              <HostBadge host={s.host} status="ok" />
              <Link
                href={`/servers/${s.host.name}`}
                className="text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                상세 보기 →
              </Link>
            </header>
            <ul className="space-y-1 text-sm">
              {s.groups.map((g) => {
                const ok = g.warningCount === 0;
                return (
                  <li
                    key={g.composeProject}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden>{ok ? "✓" : "⚠"}</span>
                      <span
                        className={`truncate font-mono ${g.isPinned ? "font-semibold" : ""}`}
                      >
                        {g.displayName}
                      </span>
                    </span>
                    <span
                      className={
                        ok
                          ? "text-zinc-600 dark:text-zinc-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {g.runningCount}/{g.totalCount}{" "}
                      {ok ? "running" : `· ${g.warningCount} issue${g.warningCount > 1 ? "s" : ""}`}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              Last updated: {new Date(s.fetchedAt).toLocaleTimeString("ko-KR")}
            </p>
          </section>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 4: index**

`src/widgets/server-overview/index.ts`:

```typescript
export { ServerOverviewCard } from "./ui/ServerOverviewCard";
export { ServerOverviewSkeleton } from "./ui/ServerOverviewSkeleton";
export { ServerOverviewError } from "./ui/ServerOverviewError";
```

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: 통과.

- [ ] **Step 6: Commit**

```bash
git add src/widgets/server-overview/
git commit -m "feat: widgets/server-overview — RSC 카드 + skeleton + error"
```

---

## Task 18: 메인 페이지 마운트

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: page.tsx 현재 내용 확인**

Run: `cat src/app/page.tsx`
(기존 ImportantEmailsCard 마운트 패턴 확인.)

- [ ] **Step 2: ServerOverviewCard 추가**

`src/app/page.tsx`에 import 추가:

```typescript
import { Suspense } from "react";
import {
  ServerOverviewCard,
  ServerOverviewSkeleton,
} from "@/widgets/server-overview";
```

기존 ImportantEmailsCard 블록 아래(또는 적절한 위치)에 추가:

```tsx
<Suspense fallback={<ServerOverviewSkeleton />}>
  <ServerOverviewCard />
</Suspense>
```

- [ ] **Step 3: 개발 서버에서 시각 확인**

Run: `pnpm dev`
브라우저에서 `http://localhost:3020`을 열어 새 카드가 보이는지 확인.
- 호스트가 seed 안 됐으면 "등록된 호스트가 없습니다" 메시지.
- seed 후 컨테이너 리스트가 표시되어야 함.

(아직 docker context가 설정 안 된 환경에서는 ServerOverviewError가 떠야 함 — 이것도 검증 포인트.)

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: 메인 페이지에 ServerOverviewCard 마운트 (Suspense)"
```

---

## Task 19: 호스트 상세 페이지 `/servers/[hostName]`

**Files:**
- Create: `src/app/servers/[hostName]/page.tsx`
- Create: `src/app/servers/[hostName]/loading.tsx`
- Create: `src/app/servers/[hostName]/error.tsx`

- [ ] **Step 1: page.tsx**

`src/app/servers/[hostName]/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getHostByName, HostBadge } from "@/entities/host";
import { listContainers } from "@/entities/container";
import { getProjects, upsertProjectFromContainer } from "@/entities/project";
import {
  groupByProject,
  ProjectGroupSection,
  StandaloneSection,
} from "@/features/container-list";
import {
  ActionButtons,
  AuditLogPanel,
  isAdmin,
} from "@/features/container-actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ hostName: string }> };

export default async function HostDetailPage({ params }: Props) {
  const { hostName } = await params;
  const host = await getHostByName(hostName);
  if (!host) notFound();

  const session = await auth();
  const adminFlag = isAdmin(
    session?.user?.email ?? null,
    process.env.ADMIN_EMAILS ?? "",
  );

  let containers: Awaited<ReturnType<typeof listContainers>> = [];
  let daemonError: string | null = null;
  try {
    containers = await listContainers({
      hostId: host.id,
      dockerContext: host.dockerContext,
    });
  } catch (err) {
    daemonError = err instanceof Error ? err.message : String(err);
  }

  const projects = await getProjects(host.id);
  const knownKeys = new Set(projects.map((p) => p.composeProject));
  const newKeys = Array.from(
    new Set(
      containers
        .map((c) => c.composeProject)
        .filter((k): k is string => k != null && !knownKeys.has(k)),
    ),
  );
  const allProjects =
    newKeys.length > 0
      ? [
          ...projects,
          ...(await Promise.all(
            newKeys.map((composeProject) =>
              upsertProjectFromContainer({ hostId: host.id, composeProject }),
            ),
          )),
        ]
      : projects;

  const groups = groupByProject(containers, allProjects);
  const standalone = groups.find((g) => g.isStandalone);
  const named = groups.filter((g) => !g.isStandalone);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <HostBadge host={host} status={daemonError ? "down" : "ok"} />
        <span className="text-xs text-zinc-500">
          context: <code>{host.dockerContext}</code> · {new Date().toLocaleTimeString("ko-KR")}
        </span>
      </header>

      {daemonError ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950">
          <p className="font-semibold text-rose-800 dark:text-rose-300">
            Docker 연결 실패
          </p>
          <p className="mt-1 break-all text-rose-700 dark:text-rose-400">
            {daemonError}
          </p>
        </section>
      ) : null}

      {named.map((g) => (
        <ProjectGroupSection
          key={g.composeProject}
          group={g}
          renderActions={(containerId, containerName) => {
            const c = g.containers.find((x) => x.id === containerId);
            if (!c) return null;
            return (
              <ActionButtons
                hostId={host.id}
                containerId={containerId}
                containerName={containerName}
                state={c.state}
                isAdmin={adminFlag}
              />
            );
          }}
        />
      ))}

      {standalone ? (
        <StandaloneSection
          group={standalone}
          renderActions={(containerId, containerName) => {
            const c = standalone.containers.find((x) => x.id === containerId);
            if (!c) return null;
            return (
              <ActionButtons
                hostId={host.id}
                containerId={containerId}
                containerName={containerName}
                state={c.state}
                isAdmin={adminFlag}
              />
            );
          }}
        />
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-2 text-sm font-semibold">최근 액션 5건</h2>
        <AuditLogPanel hostId={host.id} limit={5} />
      </section>
    </main>
  );
}
```

- [ ] **Step 2: loading.tsx**

`src/app/servers/[hostName]/loading.tsx`:

```typescript
import { ServerOverviewSkeleton } from "@/widgets/server-overview";

export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <ServerOverviewSkeleton />
      <ServerOverviewSkeleton />
    </main>
  );
}
```

- [ ] **Step 3: error.tsx**

`src/app/servers/[hostName]/error.tsx`:

```typescript
"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950">
        <h2 className="font-semibold text-rose-800 dark:text-rose-300">
          페이지 로드 실패
        </h2>
        <p className="mt-1 break-all text-sm text-rose-700 dark:text-rose-400">
          {error.message}
        </p>
        <button
          onClick={reset}
          className="mt-3 rounded border px-3 py-1 text-sm hover:bg-white dark:hover:bg-zinc-900"
        >
          다시 시도
        </button>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: 시각 확인**

Run: `pnpm dev`
브라우저에서 `http://localhost:3020/servers/home-server` 접속.
- 컨테이너 리스트 표시
- 로그인 + admin 이메일이면 액션 버튼 표시
- 다른 이메일로 로그인하면 액션 버튼 숨김

- [ ] **Step 5: Commit**

```bash
git add src/app/servers/
git commit -m "feat: /servers/[hostName] 호스트 상세 페이지 + loading/error"
```

---

## Task 20: E2E — Playwright + docker mock shim

**Files:**
- Create: `tests/fixtures/docker-mock-shim.mjs`
- Create: `tests/fixtures/docker-ndjson/healthy.ndjson`
- Create: `tests/e2e/server-infra.spec.ts`

- [ ] **Step 1: docker mock shim 작성**

`tests/fixtures/docker-mock-shim.mjs`:

```javascript
#!/usr/bin/env node
// 실제 docker CLI을 대신하는 shim. PATH 앞에 두면 listContainers 등이 이걸 호출.
// 시나리오는 process.env.DOCKER_MOCK_SCENARIO 환경변수로 선택.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ctxIdx = args.indexOf("--context");
if (ctxIdx >= 0) args.splice(ctxIdx, 2);

const sub = args[0];
const scenario = process.env.DOCKER_MOCK_SCENARIO ?? "healthy";

if (sub === "container" && args[1] === "ls") {
  const path = join(here, "docker-ndjson", `${scenario}.ndjson`);
  process.stdout.write(readFileSync(path, "utf8"));
  process.exit(0);
}
if (sub === "restart" || sub === "start" || sub === "stop") {
  process.stdout.write("");
  process.exit(0);
}
if (sub === "version") {
  process.stdout.write("Docker version mock\n");
  process.exit(0);
}
process.stderr.write(`mock-shim: unsupported args ${JSON.stringify(args)}\n`);
process.exit(1);
```

shim 실행 가능하게:

```bash
chmod +x tests/fixtures/docker-mock-shim.mjs
```

- [ ] **Step 2: healthy fixture**

`tests/fixtures/docker-ndjson/healthy.ndjson`:

```
{"ID":"a1b2c3d4e5f6","Names":"news-prod-api","State":"running","Status":"Up 3 days","Image":"img:1","Ports":"0.0.0.0:8000->8000/tcp","Labels":"com.docker.compose.project=news-prod,com.docker.compose.service=api","CreatedAt":"2026-05-07 10:23:11 +0900 KST"}
{"ID":"b2c3d4e5f6a7","Names":"news-prod-app","State":"running","Status":"Up 3 days","Image":"img:2","Ports":"0.0.0.0:3010->3010/tcp","Labels":"com.docker.compose.project=news-prod,com.docker.compose.service=app","CreatedAt":"2026-05-07 10:23:11 +0900 KST"}
{"ID":"c3d4e5f6a7b8","Names":"voice-api","State":"exited","Status":"Exited (0) 5d ago","Image":"img:3","Ports":"","Labels":"com.docker.compose.project=voice,com.docker.compose.service=api","CreatedAt":"2026-05-01 09:00:00 +0900 KST"}
{"ID":"d4e5f6a7b8c9","Names":"open-webui","State":"running","Status":"Up 12 days","Image":"img:4","Ports":"0.0.0.0:8088->8080/tcp","Labels":"","CreatedAt":"2026-04-28 11:00:00 +0900 KST"}
```

- [ ] **Step 3: E2E 스펙**

`tests/e2e/server-infra.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

// playwright.config.ts에서 PATH 앞에 tests/fixtures/를 추가하고
// `docker -> docker-mock-shim.mjs` 심볼릭 링크가 있다고 가정.
// 또는 webServer.env에 DOCKER_MOCK_SCENARIO=healthy 와 PATH 조작.

test.beforeEach(async ({ page }) => {
  // 로그인 우회: NextAuth dev mode/세션 쿠키 주입 등 프로젝트 표준 방식 사용.
  // 기존 e2e/important-emails.spec.ts의 인증 헬퍼를 그대로 재사용.
  await page.goto("/");
});

test("메인 카드가 healthy 시나리오를 표시한다", async ({ page }) => {
  await expect(page.getByText("home-server")).toBeVisible();
  await expect(page.getByText("news-prod")).toBeVisible();
  await expect(page.getByText("voice")).toBeVisible();
  await expect(page.getByText("standalone")).toBeVisible();
});

test("상세 페이지에서 컨테이너 행이 보이고 admin이면 액션 버튼이 있다", async ({ page }) => {
  await page.goto("/servers/home-server");
  await expect(page.getByText("news-prod-api")).toBeVisible();
  await expect(page.getByText("voice-api")).toBeVisible();
  // admin 로그인 가정
  await expect(page.getByRole("button", { name: /restart/i }).first()).toBeVisible();
});

test("restart 클릭 → 확인 다이얼로그 → 성공 메시지 + audit 1건 추가", async ({ page }) => {
  await page.goto("/servers/home-server");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /restart/i }).first().click();
  await expect(page.getByText(/restart 성공/)).toBeVisible();
  await expect(page.getByText("최근 액션 5건")).toBeVisible();
  await expect(page.locator("li").filter({ hasText: "restart" }).first()).toBeVisible();
});
```

- [ ] **Step 4: playwright config에 mock shim 연결**

기존 `playwright.config.ts`에서 `webServer.env`를 수정:

```typescript
webServer: {
  command: "pnpm dev",
  url: "http://localhost:3020",
  env: {
    ...process.env,
    DOCKER_MOCK_SCENARIO: "healthy",
    PATH: `${process.cwd()}/tests/fixtures:${process.env.PATH}`,
  },
}
```

`tests/fixtures/docker` 심볼릭 링크 생성:

```bash
ln -sf docker-mock-shim.mjs tests/fixtures/docker
```

- [ ] **Step 5: E2E 실행**

Run: `pnpm exec playwright test tests/e2e/server-infra.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/ tests/e2e/server-infra.spec.ts playwright.config.ts
git commit -m "test: e2e — server-infra (docker mock shim + 3 시나리오)"
```

---

## Task 21: RUNBOOK + TODOS 갱신

**Files:**
- Modify: `docs/RUNBOOK.md`
- Modify: `TODOS.md`

- [ ] **Step 1: RUNBOOK에 서버 인프라 섹션 추가**

`docs/RUNBOOK.md` 끝에 추가:

```markdown
## 서버 인프라 모니터 v0.1

### 초기 셋업
1. `.env`에 `ADMIN_EMAILS=krdn.net@gmail.com`, `DOCKER_DEFAULT_CONTEXT=home-server` 추가.
2. Docker context 등록 확인:
   ```bash
   docker context ls | grep home-server
   ```
3. 마이그레이션: `pnpm db:migrate`
4. 호스트 seed: `pnpm db:seed:hosts` (idempotent)

### 운영
- 메인 페이지 / → ServerOverviewCard에 호스트별 상태 카드 표시 (60s 자동 갱신).
- /servers/[hostName] → 호스트 상세 페이지. admin은 restart/start/stop 버튼 노출.
- 모든 액션은 `audit_logs` 테이블에 기록, 페이지 하단에 최근 5건 표시.

### Dogfooding 체크리스트
- [ ] seed 후 / 페이지에 home-server 카드가 보인다
- [ ] 컨테이너 그루핑이 compose project 라벨대로 정렬된다
- [ ] standalone 그룹에 라벨 없는 컨테이너가 모인다
- [ ] /servers/home-server 페이지가 열린다
- [ ] admin 이메일로 로그인했을 때만 액션 버튼이 보인다
- [ ] restart 버튼 클릭 → 확인 다이얼로그 → 성공 메시지가 뜬다
- [ ] audit_logs 테이블에 액션 기록이 남는다 (psql로 확인)
- [ ] Docker daemon이 닫혔을 때 빨간색 에러 카드가 표시된다 (시뮬레이션)

### 문제 해결
| 증상 | 원인 | 해결 |
|---|---|---|
| 메인 카드에 "Docker 연결 불가" | docker context 미등록 또는 SSH 실패 | `docker --context home-server version`으로 직접 검증 |
| 액션 버튼이 안 보임 | 비admin 이메일로 로그인 또는 ADMIN_EMAILS 미설정 | `.env` 확인 + 재시작 |
| 컨테이너가 모두 standalone | compose 미사용 또는 라벨 누락 | docker inspect로 라벨 확인, compose 사용 권장 |
```

- [ ] **Step 2: TODOS에 v0.2 후보 추가**

`TODOS.md` 끝에 추가:

```markdown
## 서버 인프라 모니터 v0.2 후보

- [ ] **L2 리소스 메트릭**: docker stats 주기적 호출, CPU/MEM 임계치 시각 경고
- [ ] **L3 로그 패턴 분석**: docker logs --since 기반 ERROR/FATAL 자동 감지
- [ ] **Web Push 알림**: 이상 감지 시 푸시 (이메일 위젯 인프라 재사용)
- [ ] **다호스트 등록 UI**: 추가 docker context 등록 폼 + 호스트별 health check
- [ ] **컨테이너 상세 모달**: inspect 결과 + 라이브 로그 tail
- [ ] **L4 의존성 진단**: project 내 service 그래프 + restart 루프 자동 감지
- [ ] **TimescaleDB 연동**: 시계열 메트릭 저장 (krdn-timescaledb 활용)
- [ ] **카테고리 분류 자동화**: container 이름 패턴으로 category 자동 추정
- [ ] **isHidden 토글 UI**: 노이즈 컨테이너를 대시보드에서 숨기는 인터랙션
```

- [ ] **Step 3: Commit**

```bash
git add docs/RUNBOOK.md TODOS.md
git commit -m "docs: 서버 인프라 v0.1 RUNBOOK + v0.2 후보"
```

---

## Task 22: 최종 통합 점검

**Files:** (수정 없음, 검증만)

- [ ] **Step 1: 전체 typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 2: 전체 lint**

Run: `pnpm lint`
Expected: 0 errors. eslint-plugin-boundaries 위반 없음.

- [ ] **Step 3: 전체 unit + integration 테스트**

Run: `pnpm test`
Expected: 모든 테스트 통과.

- [ ] **Step 4: E2E**

Run: `pnpm exec playwright test`
Expected: 통과.

- [ ] **Step 5: 시각 확인 (수동)**

Run: `pnpm dev`
다음을 직접 검증:
- `/`에서 ServerOverviewCard 표시
- `/servers/home-server`에서 컨테이너 리스트 + 액션 버튼
- 비admin 이메일로 로그인했을 때 액션 버튼 숨김
- 컨테이너 1개 restart → 성공 메시지 + audit_logs 추가

- [ ] **Step 6: 최종 push 직전 빌드**

Run: `pnpm build`
Expected: `.next/` 빌드 성공.

- [ ] **Step 7: 단계 commit (없으면 skip)**

만약 위 단계에서 추가 수정사항이 있으면 추가 commit.
없으면 skip하고 push 단계로.
