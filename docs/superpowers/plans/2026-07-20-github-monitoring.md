# GitHub 관제 보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** krdn org 레포의 열린 이슈·PR·Actions run 을 5분 주기로 DB 에 적재하고 `/monitoring/github` 에 표시하며, main 브랜치 Build 실패를 critical 이벤트로 발행한다.

**Architecture:** 기존 관제와 동일한 단방향 파이프라인 — cron 이 GitHub REST API 를 폴링해 DB 에 스냅샷을 적재하고, RSC 는 DB 만 읽는다. 판정 로직은 전부 순수 함수로 분리해 DB·네트워크 없이 단위 테스트한다. nav 트리는 변경하지 않고 `/monitoring` 레이아웃에 탭을 추가한다.

**Tech Stack:** Next.js 16 App Router (RSC), Drizzle ORM + PostgreSQL 16, Zod, Vitest, node-cron

**설계 스펙:** `docs/superpowers/specs/2026-07-20-github-monitoring-design.md`

## Global Constraints

- **작업 디렉토리**: 명령은 `apps/dashboard/` 기준. 루트 `pnpm <script>` 는 thin proxy 로 동일 동작.
- **FSD 의존성 방향**: `app → widgets → features → entities → shared`. 역방향 import 는 ESLint 가 차단한다.
- **entity barrel seam**: `entities/github-activity` 는 `server.ts`(DB 의존) 와 `client.ts`(타입·상수만) 두 진입점으로 분리한다. client 컴포넌트가 server barrel 을 import 하면 `Module not found: 'tls'` 로 빌드가 실패한다.
- **테스트 실행**: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`. 통합 테스트는 로컬 테스트 DB 필요(§Task 0).
- **`.tsx` 테스트 파일**: vitest include 밖이면 조용히 스킵된다. 새 `.tsx` 테스트는 단일 경로로 실행해 "1 passed" 를 눈으로 확인할 것.
- **선택 env 패턴**: compose 가 `${VAR:-}` 로 빈 문자열을 넘기므로 `z.string().min(1).optional()` 만 쓰면 빈 값에 부팅 실패한다. 반드시 `z.preprocess((v) => (v === "" ? undefined : v), ...)` 로 감쌀 것.
- **커밋 메시지**: 한국어 제목 50자 이내, 타입은 영어(`feat`/`fix`/`docs`/`test`). 본문에 `(#323)` 참조.
- **시크릿 금지**: 토큰 값을 코드·주석·커밋 메시지에 절대 남기지 않는다. 변수명으로만 지칭.

---

## Task 0: 로컬 테스트 DB 준비

**Files:** 없음 (환경 준비만)

**Interfaces:**
- Consumes: 없음
- Produces: `127.0.0.1:5999` 에서 동작하는 테스트 DB. 이후 모든 통합 테스트가 의존.

- [ ] **Step 1: 테스트 DB 컨테이너 기동**

```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine
```

이미 떠 있으면 `docker ps | grep gons-test-db` 로 확인 후 이 단계를 건너뛴다.

- [ ] **Step 2: 마이그레이션 선적용**

```bash
cd apps/dashboard
DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm db:migrate
```

Expected: 마이그레이션이 순차 적용되고 에러 없이 종료.
컨테이너만 띄우고 이 단계를 빠뜨리면 통합 테스트가 `relation does not exist` 로 전멸한다.

- [ ] **Step 3: 기존 테스트가 통과하는지 확인 (기준선)**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```

Expected: 전부 통과. 여기서 실패하는 테스트가 있으면 이 계획과 무관한 기존 문제이므로 먼저 보고할 것.

---

## Task 1: DB 스키마 + 마이그레이션

**Files:**
- Create: `apps/dashboard/src/shared/lib/db/schema/github.ts`
- Modify: `apps/dashboard/src/shared/lib/db/schema/index.ts` (마지막 export 줄 뒤에 1줄 추가)
- Create: `apps/dashboard/drizzle/<자동생성>.sql` (db:generate 산출물)

**Interfaces:**
- Consumes: 없음
- Produces: 테이블 4개 — `githubIssues`, `githubPullRequests`, `githubWorkflowRuns`, `githubSyncState`. 이후 모든 DB 접근 태스크가 이 export 를 import 한다.

- [ ] **Step 1: 스키마 파일 작성**

Create `apps/dashboard/src/shared/lib/db/schema/github.ts`:

```ts
// GitHub 관제 도메인 — 이슈 #323.
//
// github_issues / github_pull_requests: 열린 항목의 스냅샷. GitHub 가 단일
//   진실 소스이므로 동기화 시 전체 교체하고, 닫힌 항목은 자연 소멸한다.
//   전수가 아니라 updated 내림차순 최근 200건 스냅샷이다(Search API 상한).
// github_workflow_runs: 레포당 최근 20건. 초과분은 동기화가 삭제해 무한 증가를 막는다.
// github_sync_state: 소스별 동기화 건강 상태. "데이터 없음"과 "동기화가 죽어
//   데이터가 낡음"을 구분하는 단일 소스 — 이게 없으면 보드가 조용히 거짓말한다.
import { pgTable, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";

export const githubIssues = pgTable(
  "github_issues",
  {
    // "krdn/gons-dashboard#323" — repo + number 복합을 문자열로 평탄화
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    author: text("author"),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("github_issues_repo_updated_idx").on(t.repo, t.updatedAt.desc())],
);

export const githubPullRequests = pgTable(
  "github_pull_requests",
  {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    author: text("author"),
    isDraft: boolean("is_draft").notNull().default(false),
    // PR 의 현재 HEAD 커밋 sha. Search Issues 응답에 없어 pulls/{n} 로 별도 취득한다.
    // null = 취득 실패 또는 상한 초과 → CI 상태 unknown.
    headSha: text("head_sha"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("github_pull_requests_repo_created_idx").on(t.repo, t.createdAt)],
);

export const githubWorkflowRuns = pgTable(
  "github_workflow_runs",
  {
    id: text("id").primaryKey(), // GitHub run id 를 문자열화
    repo: text("repo").notNull(),
    // 안정 식별자. 워크플로 이름은 변경될 수 있어 판정에 쓰지 않는다.
    workflowId: text("workflow_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    status: text("status").notNull(),
    conclusion: text("conclusion"),
    headSha: text("head_sha").notNull(),
    headBranch: text("head_branch"),
    event: text("event"),
    // 워크플로 내 실행 순번. 서로 다른 run 간 순서를 정하는 1차 키 —
    // runAttempt 는 개별 run 안의 재시도 번호라 다른 run 끼리 비교할 수 없다.
    runNumber: integer("run_number").notNull(),
    runAttempt: integer("run_attempt").notNull().default(1),
    url: text("url").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("github_workflow_runs_repo_started_idx").on(t.repo, t.startedAt.desc()),
    index("github_workflow_runs_head_sha_idx").on(t.headSha),
  ],
);

export const githubSyncState = pgTable("github_sync_state", {
  // "issues" | "pulls" | "runs" | "build"
  source: text("source").primaryKey(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  // null = 한 번도 성공한 적 없음 (empty state 와 stale 을 가르는 값)
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  // 마지막 실패 사유. 전체 성공 시 null 로 지운다 — 안 지우면 배지가 영구히 남는다.
  lastError: text("last_error"),
  totalCount: integer("total_count"),
  truncated: boolean("truncated").notNull().default(false),

  // 아래는 source = "build" 행에서만 의미가 있다. 판정 결과를 저장해
  // RSC 가 다시 판정하지 않게 한다 (로직이 두 곳에 생기는 것을 막는다).
  buildState: text("build_state"),
  mainHeadSha: text("main_head_sha"),
  mainHeadCommittedAt: timestamp("main_head_committed_at", { withTimezone: true }),
  buildRunUrl: text("build_run_url"),
  buildConclusion: text("build_conclusion"),
});
```

- [ ] **Step 2: 배럴에 re-export 추가**

Modify `apps/dashboard/src/shared/lib/db/schema/index.ts` — 마지막 export 줄(`export * from "./monitoring";`) 바로 뒤에 추가:

```ts
export * from "./github";
```

- [ ] **Step 3: 마이그레이션 생성**

```bash
cd apps/dashboard
pnpm db:generate
```

Expected: `drizzle/` 아래 새 `.sql` 파일 생성. 출력에 4개 테이블 CREATE 가 보여야 한다.

만약 `snapshot id collision` 에러가 나면 새로 생성된 snapshot json 의 `id`/`prevId` 두 줄만 직전 스냅샷과 이어지도록 수정한다(별도 커밋).

- [ ] **Step 4: 생성된 SQL 확인**

```bash
cd apps/dashboard
ls -t drizzle/*.sql | head -1 | xargs cat
```

Expected: `CREATE TABLE "github_issues"`, `"github_pull_requests"`, `"github_workflow_runs"`, `"github_sync_state"` 4개와 인덱스 4개. 기존 테이블을 DROP 하는 구문이 있으면 **중단하고 보고**할 것.

- [ ] **Step 5: 테스트 DB 에 적용**

```bash
cd apps/dashboard
DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm db:migrate
```

Expected: 새 마이그레이션 1건 적용 성공.

- [ ] **Step 6: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/shared/lib/db/schema/github.ts \
        apps/dashboard/src/shared/lib/db/schema/index.ts \
        apps/dashboard/drizzle/
git commit -m "feat(monitoring): GitHub 관제 스키마 4개 테이블 추가 (#323)

github_issues·github_pull_requests·github_workflow_runs 는 열린 항목
스냅샷이고, github_sync_state 는 소스별 동기화 건강 상태를 담아
데이터 없음과 데이터 낡음을 구분한다."
```

---

## Task 2: 상태 정규화 순수 함수 (`normalizeRunOutcome`)

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/lib/normalizeRunOutcome.ts`
- Test: `apps/dashboard/src/features/github-monitor/lib/normalizeRunOutcome.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: `normalizeRunOutcome(run: { status: string; conclusion: string | null }): RunOutcome` where `type RunOutcome = "success" | "failure" | "running" | "inconclusive"`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/src/features/github-monitor/lib/normalizeRunOutcome.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeRunOutcome } from "./normalizeRunOutcome";

describe("normalizeRunOutcome", () => {
  it("conclusion success 는 success", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: "success" })).toBe("success");
  });

  it.each(["failure", "timed_out", "startup_failure", "action_required"])(
    "%s 는 failure",
    (conclusion) => {
      expect(normalizeRunOutcome({ status: "completed", conclusion })).toBe("failure");
    },
  );

  it.each(["queued", "in_progress", "requested", "waiting", "pending"])(
    "%s 상태는 running",
    (status) => {
      expect(normalizeRunOutcome({ status, conclusion: null })).toBe("running");
    },
  );

  it.each(["cancelled", "skipped", "neutral", "stale"])(
    "%s 는 inconclusive — 성공도 실패도 아니다",
    (conclusion) => {
      expect(normalizeRunOutcome({ status: "completed", conclusion })).toBe("inconclusive");
    },
  );

  // 회귀 가드 3: cancelled 를 failure 로 보면 사람이 의도적으로 중단한
  // 빌드마다 critical 알림이 나간다.
  it("cancelled 는 failure 가 아니다", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: "cancelled" })).not.toBe(
      "failure",
    );
  });

  it("미지의 conclusion 은 inconclusive 로 떨어진다", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: "some_new_value" })).toBe(
      "inconclusive",
    );
  });

  it("completed 인데 conclusion 이 null 이면 inconclusive", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: null })).toBe("inconclusive");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/normalizeRunOutcome.test.ts
```

Expected: FAIL — `Failed to resolve import "./normalizeRunOutcome"`

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/features/github-monitor/lib/normalizeRunOutcome.ts`:

```ts
// GitHub workflow run 의 status/conclusion 조합을 4값으로 정규화 — 순수 함수 (이슈 #323).
//
// GitHub 이 반환하는 값은 문서보다 넓고 새 값이 추가될 수 있다. 판정 함수가
// 모르는 값을 만나 조용히 오분류하지 않도록 여기서 한 번 좁힌다.
//
// ⚠️ inconclusive 를 성공으로도 실패로도 보지 않는 것이 핵심이다. 취소된 run 을
// failure 로 보면 사람이 의도적으로 중단한 빌드마다 critical 알림이 나가고,
// success 로 보면 실제로 검증되지 않은 커밋이 정상으로 표시된다.
import { logger } from "@/shared/lib/log";

export type RunOutcome = "success" | "failure" | "running" | "inconclusive";

const RUNNING_STATUSES = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);
const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "action_required",
]);
const INCONCLUSIVE_CONCLUSIONS = new Set(["cancelled", "skipped", "neutral", "stale"]);

export function normalizeRunOutcome(run: {
  status: string;
  conclusion: string | null;
}): RunOutcome {
  // status 를 먼저 본다 — 진행 중이면 conclusion 은 아직 null 이다.
  if (RUNNING_STATUSES.has(run.status)) return "running";

  const { conclusion } = run;
  if (conclusion === "success") return "success";
  if (conclusion != null && FAILURE_CONCLUSIONS.has(conclusion)) return "failure";
  if (conclusion == null || INCONCLUSIVE_CONCLUSIONS.has(conclusion)) return "inconclusive";

  // 미지의 값 — GitHub 이 새 conclusion 을 도입했을 때 알 수 있게 남긴다.
  logger.warn("github-monitor", "unknown-run-conclusion", {
    status: run.status,
    conclusion,
  });
  return "inconclusive";
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/normalizeRunOutcome.test.ts
```

Expected: PASS — 17개 케이스 전부 통과 (`it` 4개 + `it.each` 13건 전개).

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/lib/normalizeRunOutcome.ts \
        apps/dashboard/src/features/github-monitor/lib/normalizeRunOutcome.test.ts
git commit -m "feat(monitoring): GitHub run 상태 정규화 순수 함수 (#323)

status/conclusion 조합을 success/failure/running/inconclusive 로 좁힌다.
cancelled·skipped 를 inconclusive 로 분리해 의도적 중단이 critical
알림으로 새는 것과 미검증 커밋이 통과로 보이는 것을 동시에 막는다."
```

---

## Task 3: 임계값 상수 + 도메인 타입 + client barrel

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/config/thresholds.ts`
- Create: `apps/dashboard/src/entities/github-activity/model/types.ts`
- Create: `apps/dashboard/src/entities/github-activity/client.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - 상수: `GITHUB_ORG_DEFAULT`, `BUILD_REPO`, `BUILD_WORKFLOW_PATH`, `NO_RUN_GRACE_MS`, `PR_STALE_MS`, `ISSUE_TRIAGE_STALE_MS`, `TRIAGE_LABEL`, `SYNC_STALE_MS`, `ACTIVE_REPO_WINDOW_MS`, `SEARCH_MAX_PAGES`, `REPO_LIST_MAX_PAGES`, `RUNS_PER_REPO`, `PR_HEAD_FETCH_LIMIT`
  - `@/entities/github-activity/client` 에서 import 가능한 타입: `BuildState`, `PrCiStatus`, `SyncSource`, `SyncDisplayState`, `GithubIssue`, `GithubPullRequest`, `GithubWorkflowRun`, `GithubSyncState`

**⚠️ client.ts 가 여기 있는 이유**: Task 4·6·7 의 판정 함수가 이 타입들을 import 한다. DB 의존이 없어 Task 5(server barrel) 를 기다릴 필요가 없다.

- [ ] **Step 1: 임계값 상수 작성**

Create `apps/dashboard/src/features/github-monitor/config/thresholds.ts`:

```ts
// GitHub 관제 임계값·상한 — 이슈 #323.
// features/monitoring-datastore/config/thresholds.ts 의 미러 구조.
//
// 매직 넘버를 판정 함수에 흩뿌리지 않고 여기 모은다 — 임계값 조정이
// 판정 로직 수정과 섞이지 않게 하기 위함이다.

/** 감시 대상 org. env GITHUB_MONITOR_ORG 로 덮어쓸 수 있다. */
export const GITHUB_ORG_DEFAULT = "krdn";

/** 배포 파이프라인 판정 대상 레포 — 활성 레포 필터와 무관하게 항상 수집한다. */
export const BUILD_REPO = "krdn/gons-dashboard";

/**
 * Build 워크플로의 안정 식별자 (파일 경로).
 * ⚠️ 이름(`name:`)이 아니라 경로를 쓴다 — 이름은 변경돼도 경로는 유지된다.
 * 실제 워크플로 파일이 바뀌면 여기를 갱신한다.
 */
export const BUILD_WORKFLOW_PATH = ".github/workflows/ci.yml";

/**
 * main HEAD 커밋 후 이 시간 안에는 run 이 없어도 no-run 으로 판정하지 않는다.
 * push 직후 워크플로 등록까지의 정상 공백을 오탐으로 만들지 않기 위함.
 */
export const NO_RUN_GRACE_MS = 10 * 60_000;

/** PR 정체 경고 임계 (draft 제외). */
export const PR_STALE_MS = 7 * 24 * 60 * 60_000;

/** needs-triage 이슈 정체 경고 임계. */
export const ISSUE_TRIAGE_STALE_MS = 14 * 24 * 60 * 60_000;

/** 이 라벨이 붙은 이슈만 triage 정체 판정 대상. */
export const TRIAGE_LABEL = "needs-triage";

/** 마지막 성공이 이보다 오래되면 보드에 stale 배지. 5분 주기의 3배 여유. */
export const SYNC_STALE_MS = 15 * 60_000;

/** Actions 수집 대상: 이 기간 안에 push 가 있었던 레포. */
export const ACTIVE_REPO_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Search API 페이지 상한 (100건/페이지). 초과분은 보드에서 GitHub 링크로 위임. */
export const SEARCH_MAX_PAGES = 2;

/** 레포당 보관·조회할 workflow run 수. */
export const RUNS_PER_REPO = 20;

/** PR HEAD sha 를 별도 조회할 최대 PR 수. 초과분은 CI 상태 unknown. */
export const PR_HEAD_FETCH_LIMIT = 20;

/** org repos 목록 페이지 상한. */
export const REPO_LIST_MAX_PAGES = 2;
```

- [ ] **Step 2: 도메인 타입 작성**

Create `apps/dashboard/src/entities/github-activity/model/types.ts`:

```ts
// GitHub 관제 도메인 타입 — 이슈 #323.
// DB 행(schema/github.ts)과 판정 결과를 앱 계층에서 쓰는 형태로 표현한다.

/** 배포 파이프라인 판정 결과. */
export type BuildState = "synced" | "building" | "build-failed" | "no-run" | "unknown";

/** PR 의 CI 상태 (workflow run 에서 파생). */
export type PrCiStatus = "passing" | "failing" | "running" | "unknown";

/** 동기화 상태 행의 소스 구분. */
export type SyncSource = "issues" | "pulls" | "runs" | "build";

export interface GithubIssue {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GithubPullRequest {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  isDraft: boolean;
  headSha: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GithubWorkflowRun {
  id: string;
  repo: string;
  workflowId: string;
  workflowName: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  headBranch: string | null;
  event: string | null;
  runNumber: number;
  runAttempt: number;
  url: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface GithubSyncState {
  source: SyncSource;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  totalCount: number | null;
  truncated: boolean;
  // source === "build" 에서만 채워진다
  buildState: BuildState | null;
  mainHeadSha: string | null;
  mainHeadCommittedAt: Date | null;
  buildRunUrl: string | null;
  buildConclusion: string | null;
}

/** 보드가 소스별로 표시할 상태 — §4.2 순서 평가 결과. */
export type SyncDisplayState =
  | "disabled-empty" // 토큰 미설정 + 성공 이력 없음
  | "disabled-stale" // 토큰 미설정 + 이전 스냅샷 있음
  | "error" // lastError 있음 (freshness 보다 우선)
  | "empty" // 성공 이력 없음
  | "stale" // 마지막 성공이 오래됨
  | "ok";
```

- [ ] **Step 3: client 진입점 작성**

Create `apps/dashboard/src/entities/github-activity/client.ts`:

```ts
// client 진입점 — 타입만 노출한다 (DB 의존 없음).
//
// ⚠️ "use client" 컴포넌트는 반드시 이 경로로 import 할 것. server.ts 를
// import 하면 postgres 가 client bundle 그래프로 끌려와
// `Module not found: Can't resolve 'tls'` 로 빌드가 실패한다.
//
// 판정 순수 함수(features/github-monitor/lib/*)도 이 경로를 쓴다 — DB 를
// 건드리지 않으므로 server barrel 을 끌어올 이유가 없다.
export type {
  BuildState,
  PrCiStatus,
  SyncSource,
  SyncDisplayState,
  GithubIssue,
  GithubPullRequest,
  GithubWorkflowRun,
  GithubSyncState,
} from "./model/types";
```

- [ ] **Step 4: 타입 체크**

```bash
cd apps/dashboard
pnpm typecheck
```

Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/config/thresholds.ts \
        apps/dashboard/src/entities/github-activity/model/types.ts \
        apps/dashboard/src/entities/github-activity/client.ts
git commit -m "feat(monitoring): GitHub 관제 상수·타입·client barrel (#323)

임계값을 판정 로직에서 분리해 조정과 로직 수정이 섞이지 않게 한다.
Build 워크플로는 이름이 아닌 파일 경로로 식별한다.
client.ts 는 타입만 노출해 판정 함수와 위젯이 DB 를 끌어오지 않게 한다."
```

---

## Task 4: 배포 파이프라인 판정 (`judgeBuildState`)

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/lib/judgeBuildState.ts`
- Test: `apps/dashboard/src/features/github-monitor/lib/judgeBuildState.test.ts`

**Interfaces:**
- Consumes: `normalizeRunOutcome` (Task 2), `NO_RUN_GRACE_MS` (Task 3), `BuildState`·`GithubWorkflowRun` (Task 3)
- Produces:
```ts
judgeBuildState(input: {
  mainHeadSha: string;
  mainHeadCommittedAt: Date;
  runs: GithubWorkflowRun[];
  nowFn?: () => Date;
}): { state: BuildState; run: GithubWorkflowRun | null }
```

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/src/features/github-monitor/lib/judgeBuildState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { judgeBuildState } from "./judgeBuildState";
import { type GithubWorkflowRun } from "@/entities/github-activity/client";

const SHA = "a1b2c3d4";
const NOW = new Date("2026-07-20T12:00:00Z");
const nowFn = () => NOW;

function makeRun(over: Partial<GithubWorkflowRun> = {}): GithubWorkflowRun {
  return {
    id: "1",
    repo: "krdn/gons-dashboard",
    workflowId: ".github/workflows/ci.yml",
    workflowName: "CI",
    status: "completed",
    conclusion: "success",
    headSha: SHA,
    headBranch: "main",
    event: "push",
    runNumber: 10,
    runAttempt: 1,
    url: "https://github.com/x/1",
    startedAt: NOW,
    completedAt: NOW,
    ...over,
  };
}

// 커밋이 유예 시간보다 오래 전이어야 no-run 판정이 살아난다
const OLD_COMMIT = new Date(NOW.getTime() - 60 * 60_000);

describe("judgeBuildState", () => {
  it("success run 이면 synced", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: OLD_COMMIT,
      runs: [makeRun()],
      nowFn,
    });
    expect(r.state).toBe("synced");
  });

  it("진행 중이면 building", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: OLD_COMMIT,
      runs: [makeRun({ status: "in_progress", conclusion: null })],
      nowFn,
    });
    expect(r.state).toBe("building");
  });

  it("failure 면 build-failed", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: OLD_COMMIT,
      runs: [makeRun({ conclusion: "failure" })],
      nowFn,
    });
    expect(r.state).toBe("build-failed");
  });

  it("inconclusive 면 unknown", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: OLD_COMMIT,
      runs: [makeRun({ conclusion: "cancelled" })],
      nowFn,
    });
    expect(r.state).toBe("unknown");
  });

  // 회귀 가드 1: runs:[] 는 API 실패가 아니라 "정상 응답인데 run 이 없음"이다.
  // 커밋 나이에 따라 판정이 갈린다.
  it("run 없음 + 커밋 10분 이내면 unknown (오탐 방지)", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: new Date(NOW.getTime() - 5 * 60_000),
      runs: [],
      nowFn,
    });
    expect(r.state).toBe("unknown");
  });

  it("run 없음 + 커밋 10분 초과면 no-run", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: new Date(NOW.getTime() - 11 * 60_000),
      runs: [],
      nowFn,
    });
    expect(r.state).toBe("no-run");
  });

  it("정확히 10분 경계는 아직 유예 안 (unknown)", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: new Date(NOW.getTime() - 10 * 60_000),
      runs: [],
      nowFn,
    });
    expect(r.state).toBe("unknown");
  });

  it("다른 sha 의 run 은 무시한다", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: OLD_COMMIT,
      runs: [makeRun({ headSha: "zzzz", conclusion: "failure" })],
      nowFn,
    });
    expect(r.state).toBe("no-run");
  });

  // 회귀 가드 2: runAttempt 는 개별 run 안의 재시도 번호라
  // 서로 다른 run 이 모두 attempt 1 이면 순서를 못 정한다.
  it("서로 다른 run 이 모두 attempt 1 이면 runNumber 가 큰 쪽을 택한다", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: OLD_COMMIT,
      runs: [
        makeRun({ id: "old", runNumber: 10, runAttempt: 1, conclusion: "failure" }),
        makeRun({ id: "new", runNumber: 11, runAttempt: 1, conclusion: "success" }),
      ],
      nowFn,
    });
    expect(r.state).toBe("synced");
    expect(r.run?.id).toBe("new");
  });

  it("같은 runNumber 면 runAttempt 가 큰 쪽 (재실행)", () => {
    const r = judgeBuildState({
      mainHeadSha: SHA,
      mainHeadCommittedAt: OLD_COMMIT,
      runs: [
        makeRun({ id: "a1", runNumber: 10, runAttempt: 1, conclusion: "failure" }),
        makeRun({ id: "a2", runNumber: 10, runAttempt: 2, status: "in_progress", conclusion: null }),
      ],
      nowFn,
    });
    expect(r.state).toBe("building");
    expect(r.run?.id).toBe("a2");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/judgeBuildState.test.ts
```

Expected: FAIL — `Failed to resolve import "./judgeBuildState"`

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/features/github-monitor/lib/judgeBuildState.ts`:

```ts
// main 브랜치 Build 파이프라인 판정 — 순수 함수 (이슈 #323).
//
// 핵심 가치: main 에 머지했는데 GHA Build 가 실패하면 ghcr 에 새 이미지가
// 올라가지 않고 deploy-watcher 는 "변화 없음"으로 조용히 넘어간다. 이 상태를
// build-failed 로 드러내는 것이 이 관제의 존재 이유다.
//
// ⚠️ 호출자는 runs 에 "지정 workflowId · branch=main" 의 run 만 넘겨야 한다.
// 이 함수는 sha 일치만 추가로 검사한다.
import { NO_RUN_GRACE_MS } from "../config/thresholds";
import { normalizeRunOutcome } from "./normalizeRunOutcome";
import { type BuildState, type GithubWorkflowRun } from "@/entities/github-activity/client";

export interface JudgeBuildStateInput {
  mainHeadSha: string;
  mainHeadCommittedAt: Date;
  runs: GithubWorkflowRun[];
  /** 시각 주입 — wall-clock 의존 로직은 주입 없이 검증할 수 없다. */
  nowFn?: () => Date;
}

export interface JudgeBuildStateResult {
  state: BuildState;
  /** 판정 근거가 된 run (표시용). 대상이 없으면 null. */
  run: GithubWorkflowRun | null;
}

/**
 * 대상 run 선택 — (runNumber, runAttempt) 사전순 최대.
 *
 * runAttempt 만으로는 부족하다. runAttempt 는 개별 run 안의 재시도 번호라서,
 * 같은 workflow·같은 sha 에 서로 다른 run 이 여러 개 존재하면(워크플로 파일
 * 수정 후 재푸시, 트리거 중복 등) 모두 attempt 1 이 되어 순서를 정할 수 없다.
 * runNumber 는 워크플로 전체에서 단조 증가하므로 1차 키로 쓴다.
 */
function pickLatest(runs: GithubWorkflowRun[]): GithubWorkflowRun | null {
  let best: GithubWorkflowRun | null = null;
  for (const run of runs) {
    if (best == null) {
      best = run;
      continue;
    }
    if (
      run.runNumber > best.runNumber ||
      (run.runNumber === best.runNumber && run.runAttempt > best.runAttempt)
    ) {
      best = run;
    }
  }
  return best;
}

export function judgeBuildState(input: JudgeBuildStateInput): JudgeBuildStateResult {
  const now = (input.nowFn ?? (() => new Date()))();
  const candidates = input.runs.filter((r) => r.headSha === input.mainHeadSha);
  const target = pickLatest(candidates);

  if (target == null) {
    // push 직후 워크플로 등록까지의 공백은 정상이다. 유예 안에서는
    // "트리거됐는지 확인되지 않음"이므로 building 이 아니라 unknown 이다.
    const age = now.getTime() - input.mainHeadCommittedAt.getTime();
    return { state: age > NO_RUN_GRACE_MS ? "no-run" : "unknown", run: null };
  }

  switch (normalizeRunOutcome(target)) {
    case "success":
      return { state: "synced", run: target };
    case "running":
      return { state: "building", run: target };
    case "failure":
      return { state: "build-failed", run: target };
    case "inconclusive":
      return { state: "unknown", run: target };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/judgeBuildState.test.ts
```

Expected: PASS — 10개 케이스 전부 통과.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/lib/judgeBuildState.ts \
        apps/dashboard/src/features/github-monitor/lib/judgeBuildState.test.ts
git commit -m "feat(monitoring): main Build 파이프라인 판정 순수 함수 (#323)

(runNumber, runAttempt) 사전순 최대로 대상 run 을 고른다 — runAttempt 만
쓰면 서로 다른 run 이 모두 attempt 1 일 때 순서를 정할 수 없다.
push 직후 10분은 unknown 으로 두어 no-run 오탐을 막는다."
```

---

## Task 5: entity server barrel (DB 조회)

**Files:**
- Create: `apps/dashboard/src/entities/github-activity/api/queries.ts`
- Create: `apps/dashboard/src/entities/github-activity/server.ts`

**Interfaces:**
- Consumes: Task 1 스키마, Task 3 타입 (`client.ts` 는 Task 3 에서 이미 생성됨)
- Produces: `@/entities/github-activity/server` 에서 `listOpenIssues()`, `listOpenPrs()`, `listRecentRuns()`, `getSyncStates()`, `getBuildState()` — 전부 인자 없음, Promise 반환

**참고:** Task 10 이 이 파일(`server.ts`)에 쓰기 함수 export 를 추가한다.

- [ ] **Step 1: DB 조회 함수 작성**

Create `apps/dashboard/src/entities/github-activity/api/queries.ts`:

```ts
// GitHub 관제 DB 조회 — RSC 가 읽는 유일한 경로 (이슈 #323).
import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  githubIssues,
  githubPullRequests,
  githubWorkflowRuns,
  githubSyncState,
} from "@/shared/lib/db/schema";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubWorkflowRun,
  type GithubSyncState,
  type BuildState,
  type SyncSource,
} from "../model/types";

export async function listOpenIssues(): Promise<GithubIssue[]> {
  const rows = await db.select().from(githubIssues).orderBy(desc(githubIssues.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: r.url,
    author: r.author,
    labels: r.labels,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function listOpenPrs(): Promise<GithubPullRequest[]> {
  const rows = await db
    .select()
    .from(githubPullRequests)
    .orderBy(githubPullRequests.createdAt);
  return rows.map((r) => ({
    id: r.id,
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: r.url,
    author: r.author,
    isDraft: r.isDraft,
    headSha: r.headSha,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

function toRun(r: typeof githubWorkflowRuns.$inferSelect): GithubWorkflowRun {
  return {
    id: r.id,
    repo: r.repo,
    workflowId: r.workflowId,
    workflowName: r.workflowName,
    status: r.status,
    conclusion: r.conclusion,
    headSha: r.headSha,
    headBranch: r.headBranch,
    event: r.event,
    runNumber: r.runNumber,
    runAttempt: r.runAttempt,
    url: r.url,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  };
}

export async function listRecentRuns(): Promise<GithubWorkflowRun[]> {
  const rows = await db
    .select()
    .from(githubWorkflowRuns)
    .orderBy(desc(githubWorkflowRuns.startedAt));
  return rows.map(toRun);
}

export async function getSyncStates(): Promise<GithubSyncState[]> {
  const rows = await db.select().from(githubSyncState);
  return rows.map((r) => ({
    source: r.source as SyncSource,
    lastAttemptAt: r.lastAttemptAt,
    lastSuccessAt: r.lastSuccessAt,
    lastError: r.lastError,
    totalCount: r.totalCount,
    truncated: r.truncated,
    buildState: r.buildState as BuildState | null,
    mainHeadSha: r.mainHeadSha,
    mainHeadCommittedAt: r.mainHeadCommittedAt,
    buildRunUrl: r.buildRunUrl,
    buildConclusion: r.buildConclusion,
  }));
}

export async function getBuildState(): Promise<GithubSyncState | null> {
  const rows = await db
    .select()
    .from(githubSyncState)
    .where(eq(githubSyncState.source, "build"))
    .limit(1);
  const r = rows[0];
  if (r == null) return null;
  return {
    source: "build",
    lastAttemptAt: r.lastAttemptAt,
    lastSuccessAt: r.lastSuccessAt,
    lastError: r.lastError,
    totalCount: r.totalCount,
    truncated: r.truncated,
    buildState: r.buildState as BuildState | null,
    mainHeadSha: r.mainHeadSha,
    mainHeadCommittedAt: r.mainHeadCommittedAt,
    buildRunUrl: r.buildRunUrl,
    buildConclusion: r.buildConclusion,
  };
}
```

- [ ] **Step 2: server 진입점 작성**

Create `apps/dashboard/src/entities/github-activity/server.ts`:

```ts
// server 진입점 — RSC·API route·cron 이 쓰는 DB 함수를 노출한다.
// 타입은 client.ts 와 중복 노출해 server tree 에서 두 번 import 하지 않게 한다.
import "server-only";

export {
  listOpenIssues,
  listOpenPrs,
  listRecentRuns,
  getSyncStates,
  getBuildState,
} from "./api/queries";

export type {
  BuildState,
  PrCiStatus,
  SyncSource,
  SyncDisplayState,
  GithubIssue,
  GithubPullRequest,
  GithubWorkflowRun,
  GithubSyncState,
} from "./model/types";
```

- [ ] **Step 3: 타입 체크 + lint (FSD 경계 검증)**

```bash
cd apps/dashboard
pnpm typecheck && pnpm lint
```

Expected: 에러 없음. lint 가 FSD boundary 위반을 잡으므로 여기서 통과해야 한다.

- [ ] **Step 4: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/entities/github-activity/api/queries.ts \
        apps/dashboard/src/entities/github-activity/server.ts
git commit -m "feat(monitoring): github-activity server barrel (#323)

DB 조회는 server.ts 로만 나간다 — client.ts(타입만)와 분리해
client 컴포넌트가 postgres 를 끌어오는 빌드 실패를 구조적으로 막는다."
```

---

## Task 6: PR CI 상태 파생 (`derivePrCiStatus`)

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/lib/derivePrCiStatus.ts`
- Test: `apps/dashboard/src/features/github-monitor/lib/derivePrCiStatus.test.ts`

**Interfaces:**
- Consumes: `normalizeRunOutcome` (Task 2), `PrCiStatus`·`GithubPullRequest`·`GithubWorkflowRun` (Task 3/5)
- Produces: `derivePrCiStatus(pr: GithubPullRequest, runs: GithubWorkflowRun[]): PrCiStatus`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/src/features/github-monitor/lib/derivePrCiStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { derivePrCiStatus } from "./derivePrCiStatus";
import {
  type GithubPullRequest,
  type GithubWorkflowRun,
} from "@/entities/github-activity/client";

const SHA = "pr-head-sha";
const REPO = "krdn/gons-dashboard";

function makePr(over: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    id: `${REPO}#1`,
    repo: REPO,
    number: 1,
    title: "test",
    url: "https://github.com/x/1",
    author: "gon",
    isDraft: false,
    headSha: SHA,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  };
}

function makeRun(over: Partial<GithubWorkflowRun> = {}): GithubWorkflowRun {
  return {
    id: "1",
    repo: REPO,
    workflowId: "wf-1",
    workflowName: "CI",
    status: "completed",
    conclusion: "success",
    headSha: SHA,
    headBranch: "feat/x",
    event: "pull_request",
    runNumber: 1,
    runAttempt: 1,
    url: "https://github.com/x/run/1",
    startedAt: new Date(),
    completedAt: new Date(),
    ...over,
  };
}

describe("derivePrCiStatus", () => {
  it("전부 success 면 passing", () => {
    expect(derivePrCiStatus(makePr(), [makeRun()])).toBe("passing");
  });

  it("하나라도 failure 면 failing", () => {
    const runs = [makeRun({ id: "1", workflowId: "wf-1" }), makeRun({ id: "2", workflowId: "wf-2", conclusion: "failure" })];
    expect(derivePrCiStatus(makePr(), runs)).toBe("failing");
  });

  it("failure 없고 진행 중이 있으면 running", () => {
    const runs = [
      makeRun({ id: "1", workflowId: "wf-1" }),
      makeRun({ id: "2", workflowId: "wf-2", status: "in_progress", conclusion: null }),
    ];
    expect(derivePrCiStatus(makePr(), runs)).toBe("running");
  });

  // 회귀 가드 4a: every() 는 빈 배열에서 true 를 반환한다.
  // 이 가드가 없으면 run 이 하나도 없는 PR 이 "CI 통과"로 표시된다.
  it("대상 run 이 0건이면 passing 이 아니라 unknown", () => {
    expect(derivePrCiStatus(makePr(), [])).toBe("unknown");
  });

  it("headSha 가 null 이면 unknown", () => {
    expect(derivePrCiStatus(makePr({ headSha: null }), [makeRun()])).toBe("unknown");
  });

  it("success 와 inconclusive 혼합은 unknown (통과로 단정 불가)", () => {
    const runs = [
      makeRun({ id: "1", workflowId: "wf-1" }),
      makeRun({ id: "2", workflowId: "wf-2", conclusion: "cancelled" }),
    ];
    expect(derivePrCiStatus(makePr(), runs)).toBe("unknown");
  });

  it("다른 sha 의 run 은 무시한다", () => {
    expect(derivePrCiStatus(makePr(), [makeRun({ headSha: "other" })])).toBe("unknown");
  });

  // 회귀 가드 4b: sha 만으로 조인하면 같은 커밋이 fork 에 존재할 때
  // 다른 레포의 run 이 섞인다.
  it("같은 sha 라도 다른 repo 의 run 은 섞이지 않는다", () => {
    expect(derivePrCiStatus(makePr(), [makeRun({ repo: "someone/fork" })])).toBe("unknown");
  });

  it("pull_request_target 이벤트는 제외한다 (base sha 를 가리킴)", () => {
    expect(derivePrCiStatus(makePr(), [makeRun({ event: "pull_request_target" })])).toBe(
      "unknown",
    );
  });

  it("workflow 별로 최신 (runNumber, runAttempt) 만 집계한다", () => {
    const runs = [
      makeRun({ id: "old", workflowId: "wf-1", runNumber: 1, conclusion: "failure" }),
      makeRun({ id: "new", workflowId: "wf-1", runNumber: 2, conclusion: "success" }),
    ];
    expect(derivePrCiStatus(makePr(), runs)).toBe("passing");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/derivePrCiStatus.test.ts
```

Expected: FAIL — import 해결 실패.

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/features/github-monitor/lib/derivePrCiStatus.ts`:

```ts
// PR 의 CI 상태를 workflow run 에서 파생 — 순수 함수 (이슈 #323).
//
// Search Issues 응답에는 PR 의 head.sha 가 없어 pulls/{n} 로 별도 취득한
// headSha 를 조인 키로 쓴다.
//
// ⚠️ head_sha 단순 조인은 안전하지 않다:
//   - pull_request 이벤트 run 의 head_sha 는 합성 merge SHA 일 수 있다
//   - pull_request_target 은 base SHA 를 가리킨다
//   - 같은 커밋이 fork 에 존재하면 다른 레포의 run 이 섞인다
// 따라서 repo·sha·event 세 조건을 모두 검사한다.
import { normalizeRunOutcome } from "./normalizeRunOutcome";
import {
  type PrCiStatus,
  type GithubPullRequest,
  type GithubWorkflowRun,
} from "@/entities/github-activity/client";

const ALLOWED_EVENTS = new Set(["push", "pull_request"]);

export function derivePrCiStatus(
  pr: GithubPullRequest,
  runs: GithubWorkflowRun[],
): PrCiStatus {
  if (pr.headSha == null) return "unknown";

  const matched = runs.filter(
    (r) =>
      r.repo === pr.repo &&
      r.headSha === pr.headSha &&
      r.event != null &&
      ALLOWED_EVENTS.has(r.event),
  );

  // workflow 별 최신 (runNumber, runAttempt) 하나씩만 집계 — 재실행이 있으면
  // 옛 실패가 현재 상태를 뒤집으면 안 된다.
  const latestByWorkflow = new Map<string, GithubWorkflowRun>();
  for (const run of matched) {
    const prev = latestByWorkflow.get(run.workflowId);
    if (
      prev == null ||
      run.runNumber > prev.runNumber ||
      (run.runNumber === prev.runNumber && run.runAttempt > prev.runAttempt)
    ) {
      latestByWorkflow.set(run.workflowId, run);
    }
  }

  const outcomes = [...latestByWorkflow.values()].map(normalizeRunOutcome);

  // 순서대로 평가하고 마지막을 catch-all 로 둔다 — 명시 조건만 나열하면
  // success + inconclusive 같은 혼합 조합이 어느 분기에도 걸리지 않는다.
  if (outcomes.includes("failure")) return "failing";
  if (outcomes.includes("running")) return "running";
  // ⚠️ "1개 이상" 은 구현상 필수다. every() 는 빈 배열에서 true 라
  // 이 조건이 없으면 run 이 없는 PR 이 passing 으로 표시된다.
  if (outcomes.length > 0 && outcomes.every((o) => o === "success")) return "passing";
  return "unknown";
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/derivePrCiStatus.test.ts
```

Expected: PASS — 10개 케이스 전부 통과.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/lib/derivePrCiStatus.ts \
        apps/dashboard/src/features/github-monitor/lib/derivePrCiStatus.test.ts
git commit -m "feat(monitoring): PR CI 상태 파생 순수 함수 (#323)

repo·sha·event 세 조건으로 조인해 merge SHA 오조인과 fork 혼입을 막는다.
passing 은 대상 run 1개 이상일 때만 — every() 는 빈 배열에서 true 라
조건이 없으면 run 없는 PR 이 통과로 표시된다."
```

---

## Task 7: 정체 판정 + 보드 표시 상태 (`judgeStaleness`, `deriveSyncDisplayState`)

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/lib/judgeStaleness.ts`
- Test: `apps/dashboard/src/features/github-monitor/lib/judgeStaleness.test.ts`

**Interfaces:**
- Consumes: Task 3 상수·타입
- Produces:
  - `isPrStale(pr: GithubPullRequest, nowFn?: () => Date): boolean`
  - `isIssueTriageStale(issue: GithubIssue, nowFn?: () => Date): boolean`
  - `deriveSyncDisplayState(state: GithubSyncState | null, opts: { tokenConfigured: boolean; nowFn?: () => Date }): SyncDisplayState`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/src/features/github-monitor/lib/judgeStaleness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPrStale, isIssueTriageStale, deriveSyncDisplayState } from "./judgeStaleness";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubSyncState,
} from "@/entities/github-activity/client";

const NOW = new Date("2026-07-20T12:00:00Z");
const nowFn = () => NOW;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60_000);

function makePr(over: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    id: "r#1", repo: "krdn/x", number: 1, title: "t", url: "u", author: "gon",
    isDraft: false, headSha: "s", createdAt: daysAgo(1), updatedAt: daysAgo(1), ...over,
  };
}

function makeIssue(over: Partial<GithubIssue> = {}): GithubIssue {
  return {
    id: "r#1", repo: "krdn/x", number: 1, title: "t", url: "u", author: "gon",
    labels: [], createdAt: daysAgo(1), updatedAt: daysAgo(1), ...over,
  };
}

function makeState(over: Partial<GithubSyncState> = {}): GithubSyncState {
  return {
    source: "issues", lastAttemptAt: NOW, lastSuccessAt: NOW, lastError: null,
    totalCount: 0, truncated: false, buildState: null, mainHeadSha: null,
    mainHeadCommittedAt: null, buildRunUrl: null, buildConclusion: null, ...over,
  };
}

describe("isPrStale", () => {
  it("7일 초과면 정체", () => {
    expect(isPrStale(makePr({ createdAt: daysAgo(8) }), nowFn)).toBe(true);
  });
  it("7일 이내면 정상", () => {
    expect(isPrStale(makePr({ createdAt: daysAgo(6) }), nowFn)).toBe(false);
  });
  it("draft 는 오래돼도 제외", () => {
    expect(isPrStale(makePr({ createdAt: daysAgo(30), isDraft: true }), nowFn)).toBe(false);
  });
});

describe("isIssueTriageStale", () => {
  it("needs-triage + 14일 초과면 정체", () => {
    expect(isIssueTriageStale(makeIssue({ labels: ["needs-triage"], createdAt: daysAgo(15) }), nowFn)).toBe(true);
  });
  it("라벨 없으면 오래돼도 제외", () => {
    expect(isIssueTriageStale(makeIssue({ labels: [], createdAt: daysAgo(100) }), nowFn)).toBe(false);
  });
  it("needs-triage + 14일 이내는 정상", () => {
    expect(isIssueTriageStale(makeIssue({ labels: ["needs-triage"], createdAt: daysAgo(13) }), nowFn)).toBe(false);
  });
});

describe("deriveSyncDisplayState", () => {
  it("토큰 없음 + 성공 이력 없음 → disabled-empty", () => {
    expect(deriveSyncDisplayState(makeState({ lastSuccessAt: null }), { tokenConfigured: false, nowFn })).toBe("disabled-empty");
  });

  it("토큰 없음 + 성공 이력 있음 → disabled-stale (기존 스냅샷 유지)", () => {
    expect(deriveSyncDisplayState(makeState(), { tokenConfigured: false, nowFn })).toBe("disabled-stale");
  });

  // 회귀 가드 11: lastError 가 freshness 보다 우선한다.
  it("최근 성공했어도 lastError 있으면 error", () => {
    expect(deriveSyncDisplayState(makeState({ lastError: "429" }), { tokenConfigured: true, nowFn })).toBe("error");
  });

  // 회귀 가드 10: 첫 동기화가 부분 성공이면 empty 가 아니라 error —
  // 데이터가 있는데 "없음"이라 표시하면 안 된다.
  it("첫 부분 성공(lastSuccessAt null + lastError) 은 empty 가 아니라 error", () => {
    expect(deriveSyncDisplayState(makeState({ lastSuccessAt: null, lastError: "1개 레포 실패" }), { tokenConfigured: true, nowFn })).toBe("error");
  });

  it("성공 이력 없음 + 오류 없음 → empty", () => {
    expect(deriveSyncDisplayState(makeState({ lastSuccessAt: null }), { tokenConfigured: true, nowFn })).toBe("empty");
  });

  it("마지막 성공이 15분 초과 → stale", () => {
    expect(deriveSyncDisplayState(makeState({ lastSuccessAt: new Date(NOW.getTime() - 16 * 60_000) }), { tokenConfigured: true, nowFn })).toBe("stale");
  });

  it("최근 성공 + 오류 없음 → ok", () => {
    expect(deriveSyncDisplayState(makeState(), { tokenConfigured: true, nowFn })).toBe("ok");
  });

  it("행 자체가 없으면 empty", () => {
    expect(deriveSyncDisplayState(null, { tokenConfigured: true, nowFn })).toBe("empty");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/judgeStaleness.test.ts
```

Expected: FAIL — import 해결 실패.

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/features/github-monitor/lib/judgeStaleness.ts`:

```ts
// 정체 판정 + 보드 표시 상태 — 순수 함수 (이슈 #323).
// 정체는 보드 강조용이며 알림을 발행하지 않는다 (노이즈 억제).
import {
  PR_STALE_MS,
  ISSUE_TRIAGE_STALE_MS,
  TRIAGE_LABEL,
  SYNC_STALE_MS,
} from "../config/thresholds";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubSyncState,
  type SyncDisplayState,
} from "@/entities/github-activity/client";

export function isPrStale(pr: GithubPullRequest, nowFn: () => Date = () => new Date()): boolean {
  // draft 는 의도적으로 열어둔 것이라 정체가 아니다.
  if (pr.isDraft) return false;
  return nowFn().getTime() - pr.createdAt.getTime() > PR_STALE_MS;
}

export function isIssueTriageStale(
  issue: GithubIssue,
  nowFn: () => Date = () => new Date(),
): boolean {
  if (!issue.labels.includes(TRIAGE_LABEL)) return false;
  return nowFn().getTime() - issue.createdAt.getTime() > ISSUE_TRIAGE_STALE_MS;
}

/**
 * 보드가 소스별로 표시할 상태를 정한다 — 순서대로 평가한다.
 *
 * ⚠️ lastError 가 freshness 보다 앞선다. 최근에 성공한 적이 있어도 직전
 * 시도가 실패했으면 그 사실을 먼저 알려야 한다. 또 error 가 empty 보다
 * 앞서므로, 첫 동기화가 부분 성공인 경우에도 성공한 레포의 데이터를
 * 보여주면서 오류 배지를 단다 — 데이터가 있는데 "없음"이라 표시하지 않는다.
 */
export function deriveSyncDisplayState(
  state: GithubSyncState | null,
  opts: { tokenConfigured: boolean; nowFn?: () => Date },
): SyncDisplayState {
  const now = (opts.nowFn ?? (() => new Date()))();
  const lastSuccessAt = state?.lastSuccessAt ?? null;

  if (!opts.tokenConfigured) {
    return lastSuccessAt == null ? "disabled-empty" : "disabled-stale";
  }
  if (state?.lastError != null && state.lastError !== "") return "error";
  if (lastSuccessAt == null) return "empty";
  if (now.getTime() - lastSuccessAt.getTime() > SYNC_STALE_MS) return "stale";
  return "ok";
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/judgeStaleness.test.ts
```

Expected: PASS — 14개 케이스 전부 통과.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/lib/judgeStaleness.ts \
        apps/dashboard/src/features/github-monitor/lib/judgeStaleness.test.ts
git commit -m "feat(monitoring): 정체 판정·보드 표시 상태 순수 함수 (#323)

deriveSyncDisplayState 는 lastError 를 freshness 보다 먼저 평가한다 —
첫 부분 성공에서도 데이터를 보여주며 오류 배지를 달아, 데이터가 있는데
없다고 표시하는 것을 막는다."
```

---

## Task 8: 환경 변수 추가

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts` (TZ 항목 바로 앞에 삽입)
- Modify: `apps/dashboard/.env.example`

**Interfaces:**
- Consumes: 없음
- Produces: `env.GITHUB_MONITOR_TOKEN` (string | undefined), `env.GITHUB_MONITOR_ORG` (string, 기본 "krdn")

- [ ] **Step 1: env 스키마에 추가**

Modify `apps/dashboard/src/shared/config/env.ts` — `// 타임존 (cron + DB 쿼리에 결정적)` 주석 **바로 앞**에 삽입:

```ts
  // GitHub 관제 (이슈 #323) — 둘 다 선택. 토큰 미설정 시 동기화 cron 이
  // skip 하고 보드는 "동기화 비활성" 배지를 표시한다(기존 스냅샷은 유지).
  // 토큰 누락이 앱 부팅을 막으면 안 되므로 필수로 만들지 않는다.
  // compose 가 `${VAR:-}` 로 빈 문자열을 넘기므로 preprocess 로 "" → undefined.
  GITHUB_MONITOR_TOKEN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  GITHUB_MONITOR_ORG: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).default("krdn"),
  ),

```

- [ ] **Step 2: .env.example 에 추가**

Modify `apps/dashboard/.env.example` — 파일 끝에 추가:

```bash
# GitHub 관제 (이슈 #323) — 선택. 미설정 시 /monitoring/github 보드가 비활성.
# Fine-grained PAT, org krdn 에 read-only: Issues·Pull requests·Actions·Metadata
GITHUB_MONITOR_TOKEN=
GITHUB_MONITOR_ORG=krdn
```

- [ ] **Step 3: 타입 체크**

```bash
cd apps/dashboard
pnpm typecheck
```

Expected: 에러 없음.

- [ ] **Step 4: 토큰 없이 부팅되는지 확인 (핵심 검증)**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/
```

Expected: PASS. env 검증이 throw 하면 여기서 전부 실패하므로 이 실행이 선택 env 가 부팅을 막지 않는다는 증거가 된다.

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/shared/config/env.ts apps/dashboard/.env.example
git commit -m "feat(monitoring): GITHUB_MONITOR_TOKEN·ORG 선택 env 추가 (#323)

토큰 누락이 앱 부팅을 막지 않도록 optional 로 둔다. compose 가 빈
문자열을 넘기므로 preprocess 로 '' → undefined 변환이 필요하다."
```

---

## Task 9: GitHub API 클라이언트

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/lib/githubClient.ts`
- Test: `apps/dashboard/src/features/github-monitor/lib/githubClient.test.ts`

**Interfaces:**
- Consumes: Task 3 상수, Task 8 env
- Produces:
  - `class GithubApiError extends Error { status: number }`
  - `searchIssues(token, org, kind: "issue" | "pr"): Promise<{ items: RawSearchItem[]; totalCount: number; truncated: boolean }>`
  - `listActiveRepos(token, org, nowFn?): Promise<string[]>`
  - `listWorkflowRuns(token, repo): Promise<RawRun[]>`
  - `listBuildRuns(token, repo, workflowPath): Promise<RawRun[]>`
  - `getMainHead(token, repo): Promise<{ sha: string; committedAt: Date }>`
  - `getPullHeadSha(token, repo, number): Promise<string>`
  - 타입 `RawSearchItem`, `RawRun`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/src/features/github-monitor/lib/githubClient.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { searchIssues, listActiveRepos, GithubApiError } from "./githubClient";

const TOKEN = "test-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchIssues", () => {
  it("단일 페이지 결과를 반환한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ total_count: 2, incomplete_results: false, items: [{ id: 1 }, { id: 2 }] }),
    );
    const r = await searchIssues(TOKEN, "krdn", "issue");
    expect(r.items).toHaveLength(2);
    expect(r.totalCount).toBe(2);
    expect(r.truncated).toBe(false);
  });

  // incomplete_results 는 GitHub 이 쿼리를 타임아웃시킨 부분 결과다.
  // 이걸로 스냅샷을 교체하면 멀쩡한 항목이 사라진다.
  it("incomplete_results 면 throw 한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ total_count: 1, incomplete_results: true, items: [{ id: 1 }] }),
    );
    await expect(searchIssues(TOKEN, "krdn", "issue")).rejects.toThrow(GithubApiError);
  });

  // 401=토큰 무효, 403=권한 부족/2차 rate limit, 429=rate limit.
  // 셋 다 "스냅샷을 교체하면 안 되는 실패"라 같은 경로로 흘러야 한다.
  it.each([401, 403, 429])("%i 이면 GithubApiError 로 status 를 실어 던진다", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "Bad" }, status));
    await expect(searchIssues(TOKEN, "krdn", "issue")).rejects.toMatchObject({ status });
  });

  it("네트워크 오류도 GithubApiError 로 감싼다 (status 0)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(searchIssues(TOKEN, "krdn", "issue")).rejects.toMatchObject({ status: 0 });
  });

  it("2페이지 상한에서 자르고 truncated 를 표시한다", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ total_count: 500, incomplete_results: false, items: full }),
    );
    const r = await searchIssues(TOKEN, "krdn", "issue");
    expect(r.items).toHaveLength(200); // 100 × 2페이지
    expect(r.truncated).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("결과가 페이지 크기 미만이면 다음 페이지를 요청하지 않는다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ total_count: 3, incomplete_results: false, items: [{ id: 1 }] }),
    );
    await searchIssues(TOKEN, "krdn", "issue");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("listActiveRepos", () => {
  const NOW = new Date("2026-07-20T12:00:00Z");
  const nowFn = () => NOW;
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60_000).toISOString();

  it("7일 이내 push 된 레포만 돌려준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        { full_name: "krdn/a", pushed_at: daysAgo(1) },
        { full_name: "krdn/b", pushed_at: daysAgo(30) },
      ]),
    );
    const repos = await listActiveRepos(TOKEN, "krdn", nowFn);
    expect(repos).toContain("krdn/a");
    expect(repos).not.toContain("krdn/b");
  });

  // 배포 파이프라인 판정 대상이라 push 가 없어도 항상 포함해야 한다.
  it("gons-dashboard 는 오래돼도 항상 포함한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([{ full_name: "krdn/gons-dashboard", pushed_at: daysAgo(365) }]),
    );
    const repos = await listActiveRepos(TOKEN, "krdn", nowFn);
    expect(repos).toContain("krdn/gons-dashboard");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/githubClient.test.ts
```

Expected: FAIL — import 해결 실패.

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/features/github-monitor/lib/githubClient.ts`:

```ts
// GitHub REST API 클라이언트 — 이슈 #323.
//
// 에러를 GithubApiError 로 정규화해 호출자가 "실패했으니 스냅샷을 교체하지
// 않는다"를 단일 조건으로 판단할 수 있게 한다.
//
// ⚠️ incomplete_results 를 성공으로 취급하지 않는다. GitHub 이 쿼리를
// 타임아웃시킨 부분 결과로 스냅샷을 교체하면 멀쩡한 항목이 사라진다.
import "server-only";
import {
  SEARCH_MAX_PAGES,
  REPO_LIST_MAX_PAGES,
  ACTIVE_REPO_WINDOW_MS,
  RUNS_PER_REPO,
  BUILD_REPO,
} from "../config/thresholds";

const API = "https://api.github.com";
const PER_PAGE = 100;

export class GithubApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
  }
}

export interface RawSearchItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  labels: { name: string }[];
  draft?: boolean;
  repository_url: string;
  created_at: string;
  updated_at: string;
}

export interface RawRun {
  id: number;
  name: string | null;
  workflow_id: number;
  path?: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_branch: string | null;
  event: string | null;
  run_number: number;
  run_attempt: number;
  html_url: string;
  run_started_at: string | null;
  updated_at: string | null;
}

async function gh<T>(token: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // Next 의 fetch 캐시가 끼면 폴링이 옛 결과를 되돌려준다.
      cache: "no-store",
    });
  } catch (err) {
    throw new GithubApiError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) {
    throw new GithubApiError(`GitHub ${path} → ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: RawSearchItem[];
}

export async function searchIssues(
  token: string,
  org: string,
  kind: "issue" | "pr",
): Promise<{ items: RawSearchItem[]; totalCount: number; truncated: boolean }> {
  const q = encodeURIComponent(`org:${org} is:${kind} is:open`);
  const items: RawSearchItem[] = [];
  let totalCount = 0;
  let truncated = false;

  for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
    const res = await gh<SearchResponse>(
      token,
      `/search/issues?q=${q}&sort=updated&order=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    if (res.incomplete_results) {
      throw new GithubApiError("search returned incomplete_results", 0);
    }
    totalCount = res.total_count;
    items.push(...res.items);
    // 페이지가 꽉 차지 않았으면 마지막 페이지다.
    if (res.items.length < PER_PAGE) break;
    if (page === SEARCH_MAX_PAGES && totalCount > items.length) truncated = true;
  }

  return { items, totalCount, truncated };
}

interface RawRepo {
  full_name: string;
  pushed_at: string | null;
}

export async function listActiveRepos(
  token: string,
  org: string,
  nowFn: () => Date = () => new Date(),
): Promise<string[]> {
  const cutoff = nowFn().getTime() - ACTIVE_REPO_WINDOW_MS;
  const active = new Set<string>();

  for (let page = 1; page <= REPO_LIST_MAX_PAGES; page++) {
    const repos = await gh<RawRepo[]>(
      token,
      `/orgs/${org}/repos?sort=pushed&direction=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    let hitCutoff = false;
    for (const r of repos) {
      const pushed = r.pushed_at == null ? 0 : Date.parse(r.pushed_at);
      if (pushed >= cutoff) active.add(r.full_name);
      else hitCutoff = true;
    }
    // pushed 내림차순이므로 cutoff 를 만났거나 페이지가 덜 찼으면 멈춘다.
    if (hitCutoff || repos.length < PER_PAGE) break;
  }

  // 활성 필터와 무관하게 항상 포함 — 배포 파이프라인 판정 대상이다.
  active.add(BUILD_REPO);
  return [...active];
}

export async function listWorkflowRuns(token: string, repo: string): Promise<RawRun[]> {
  const res = await gh<{ workflow_runs: RawRun[] }>(
    token,
    `/repos/${repo}/actions/runs?per_page=${RUNS_PER_REPO}`,
  );
  return res.workflow_runs;
}

export async function listBuildRuns(
  token: string,
  repo: string,
  workflowPath: string,
): Promise<RawRun[]> {
  const wf = encodeURIComponent(workflowPath);
  const res = await gh<{ workflow_runs: RawRun[] }>(
    token,
    `/repos/${repo}/actions/workflows/${wf}/runs?branch=main&per_page=5`,
  );
  return res.workflow_runs;
}

export async function getMainHead(
  token: string,
  repo: string,
): Promise<{ sha: string; committedAt: Date }> {
  const res = await gh<{
    sha: string;
    commit: { committer: { date: string } | null };
  }>(token, `/repos/${repo}/commits/main`);
  const date = res.commit.committer?.date;
  return {
    sha: res.sha,
    committedAt: date == null ? new Date(0) : new Date(date),
  };
}

export async function getPullHeadSha(
  token: string,
  repo: string,
  number: number,
): Promise<string> {
  const res = await gh<{ head: { sha: string } }>(token, `/repos/${repo}/pulls/${number}`);
  return res.head.sha;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/github-monitor/lib/githubClient.test.ts
```

Expected: PASS — 10개 케이스 전부 통과 (`it` 7개 + `it.each` 3건 전개).

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/lib/githubClient.ts \
        apps/dashboard/src/features/github-monitor/lib/githubClient.test.ts
git commit -m "feat(monitoring): GitHub REST API 클라이언트 (#323)

에러를 GithubApiError 로 정규화하고 incomplete_results 를 실패로
취급한다 — 부분 결과로 스냅샷을 교체하면 멀쩡한 항목이 사라진다.
Search 는 2페이지 상한, org repos 는 pushed 내림차순 cutoff 순회."
```

---

## Task 10: DB 쓰기 (스냅샷 교체)

**Files:**
- Create: `apps/dashboard/src/entities/github-activity/api/sync.ts`
- Modify: `apps/dashboard/src/entities/github-activity/server.ts` (Task 5 가 만든 파일 — export 블록 추가)
- Test: `apps/dashboard/tests/integration/github-sync-db.test.ts`

**Interfaces:**
- Consumes: Task 1 스키마, Task 3 타입
- Produces:
  - `replaceIssues(rows: NewIssue[]): Promise<void>` — 전체 삭제 후 삽입 (트랜잭션)
  - `replacePrs(rows: NewPr[]): Promise<void>`
  - `replaceRunsForRepo(repo: string, rows: NewRun[]): Promise<void>` — 해당 repo 만 교체
  - `upsertSyncState(source, patch): Promise<void>`

- [ ] **Step 1: 실패하는 통합 테스트 작성**

Create `apps/dashboard/tests/integration/github-sync-db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { githubIssues, githubWorkflowRuns, githubSyncState } from "@/shared/lib/db/schema";
import {
  replaceIssues,
  replaceRunsForRepo,
  upsertSyncState,
} from "@/entities/github-activity/server";

const ISSUE = {
  id: "krdn/a#1",
  repo: "krdn/a",
  number: 1,
  title: "t",
  url: "u",
  author: "gon",
  labels: ["needs-triage"],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
};

function makeRun(over: Partial<typeof githubWorkflowRuns.$inferInsert> = {}) {
  return {
    id: "1",
    repo: "krdn/a",
    workflowId: "wf",
    workflowName: "CI",
    status: "completed",
    conclusion: "success",
    headSha: "sha",
    headBranch: "main",
    event: "push",
    runNumber: 1,
    runAttempt: 1,
    url: "u",
    startedAt: new Date(),
    completedAt: new Date(),
    ...over,
  };
}

beforeEach(async () => {
  await db.delete(githubIssues);
  await db.delete(githubWorkflowRuns);
  await db.delete(githubSyncState);
});

describe("replaceIssues", () => {
  it("기존 행을 지우고 새 스냅샷으로 교체한다", async () => {
    await replaceIssues([ISSUE]);
    await replaceIssues([{ ...ISSUE, id: "krdn/a#2", number: 2 }]);
    const rows = await db.select().from(githubIssues);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("krdn/a#2");
  });

  it("빈 배열이면 전부 지운다 (열린 이슈 0건은 정상 상태)", async () => {
    await replaceIssues([ISSUE]);
    await replaceIssues([]);
    expect(await db.select().from(githubIssues)).toHaveLength(0);
  });
});

describe("replaceRunsForRepo", () => {
  // §4.2 규칙 2: Actions 는 레포 단위로 독립 교체된다.
  it("지정한 레포만 교체하고 다른 레포는 건드리지 않는다", async () => {
    await replaceRunsForRepo("krdn/a", [makeRun({ id: "a1", repo: "krdn/a" })]);
    await replaceRunsForRepo("krdn/b", [makeRun({ id: "b1", repo: "krdn/b" })]);
    await replaceRunsForRepo("krdn/a", [makeRun({ id: "a2", repo: "krdn/a" })]);

    const rows = await db.select().from(githubWorkflowRuns);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["a2", "b1"]);
  });
});

describe("upsertSyncState", () => {
  it("행이 없으면 만들고 있으면 갱신한다", async () => {
    await upsertSyncState("issues", { lastAttemptAt: new Date(), lastError: "boom" });
    await upsertSyncState("issues", { lastSuccessAt: new Date(), lastError: null });

    const rows = await db.select().from(githubSyncState);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastError).toBeNull();
    expect(rows[0]?.lastSuccessAt).not.toBeNull();
  });

  it("지정하지 않은 필드는 보존한다", async () => {
    const attempt = new Date("2026-07-20T00:00:00Z");
    await upsertSyncState("issues", { lastAttemptAt: attempt });
    await upsertSyncState("issues", { lastError: "x" });

    const rows = await db.select().from(githubSyncState);
    expect(rows[0]?.lastAttemptAt?.toISOString()).toBe(attempt.toISOString());
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run tests/integration/github-sync-db.test.ts
```

Expected: FAIL — `replaceIssues` 등이 export 되지 않음.

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/entities/github-activity/api/sync.ts`:

```ts
// GitHub 관제 DB 쓰기 — 스냅샷 교체 (이슈 #323 §4.2).
//
// ⚠️ 호출자는 원격 응답을 **완전히 수집한 뒤에만** 이 함수들을 부른다.
// 페이지 도중 실패한 부분 결과로 교체하면 멀쩡한 행이 사라진다.
// 교체는 DELETE+INSERT 를 단일 트랜잭션으로 묶어 중간 상태가 보이지 않게 한다.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  githubIssues,
  githubPullRequests,
  githubWorkflowRuns,
  githubSyncState,
} from "@/shared/lib/db/schema";
import { type SyncSource } from "../model/types";

type NewIssue = typeof githubIssues.$inferInsert;
type NewPr = typeof githubPullRequests.$inferInsert;
type NewRun = typeof githubWorkflowRuns.$inferInsert;
type SyncPatch = Partial<Omit<typeof githubSyncState.$inferInsert, "source">>;

export async function replaceIssues(rows: NewIssue[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(githubIssues);
    if (rows.length > 0) await tx.insert(githubIssues).values(rows);
  });
}

export async function replacePrs(rows: NewPr[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(githubPullRequests);
    if (rows.length > 0) await tx.insert(githubPullRequests).values(rows);
  });
}

/**
 * 레포 단위 교체 — 한 레포의 Actions 조회가 실패해도 그 레포의 이전 run 만
 * 유지되고 나머지는 갱신되도록 호출자가 레포별로 부른다.
 */
export async function replaceRunsForRepo(repo: string, rows: NewRun[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(githubWorkflowRuns).where(eq(githubWorkflowRuns.repo, repo));
    if (rows.length > 0) await tx.insert(githubWorkflowRuns).values(rows);
  });
}

/**
 * 부분 갱신 — 지정한 필드만 덮어쓰고 나머지는 보존한다.
 * lastError 를 명시적으로 null 로 넘기면 지워진다(전체 성공 시).
 */
export async function upsertSyncState(source: SyncSource, patch: SyncPatch): Promise<void> {
  await db
    .insert(githubSyncState)
    .values({ source, ...patch })
    .onConflictDoUpdate({ target: githubSyncState.source, set: patch });
}
```

- [ ] **Step 4: server 배럴에 export 추가**

Modify `apps/dashboard/src/entities/github-activity/server.ts` — `getBuildState,` 를 export 하는 블록 **뒤에** 추가:

```ts
export {
  replaceIssues,
  replacePrs,
  replaceRunsForRepo,
  upsertSyncState,
} from "./api/sync";
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run tests/integration/github-sync-db.test.ts
```

Expected: PASS — 5개 케이스 전부 통과.

`ECONNREFUSED` 가 나오면 Task 0 의 테스트 DB 가 안 떠 있는 것이다.

- [ ] **Step 6: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/entities/github-activity/api/sync.ts \
        apps/dashboard/src/entities/github-activity/server.ts \
        apps/dashboard/tests/integration/github-sync-db.test.ts
git commit -m "feat(monitoring): GitHub 스냅샷 교체 DB 쓰기 (#323)

DELETE+INSERT 를 트랜잭션으로 묶고 Actions 는 레포 단위로 교체해
한 레포 실패가 다른 레포 데이터를 지우지 않게 한다."
```

---

## Task 11: 동기화 오케스트레이션

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/index.ts`
- Test: `apps/dashboard/tests/integration/github-sync-orchestration.test.ts`

**Interfaces:**
- Consumes: Task 9 클라이언트, Task 10 DB 쓰기, Task 4 판정
- Produces: `syncGithub(opts?: { nowFn?: () => Date }): Promise<SyncSummary>` where
```ts
interface SyncSummary {
  skipped: boolean;              // 토큰 미설정
  issues: { ok: boolean; count: number; error?: string };
  pulls: { ok: boolean; count: number; error?: string };
  runs: { ok: boolean; repos: number; failedRepos: string[] };
  build: { ok: boolean; state: BuildState | null; error?: string };
}
```

- [ ] **Step 1: 실패하는 통합 테스트 작성**

Create `apps/dashboard/tests/integration/github-sync-orchestration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/shared/lib/db/client";
import {
  githubIssues,
  githubWorkflowRuns,
  githubSyncState,
  monitoringEvents,
} from "@/shared/lib/db/schema";

const BUILD_DEDUP = "github:krdn/gons-dashboard:build-failed";

/**
 * env 는 모듈 로드 시점에 평가되므로 동적 import 로 갈아끼운다.
 *
 * ⚠️ importActual 로 실제 env 를 펼친 뒤 두 필드만 덮는다 — 객체를 통째로
 * 교체하면 syncGithub 가 (지금은 아니어도 나중에) 다른 env 를 읽을 때
 * undefined 를 만나 테스트가 진짜 원인과 무관하게 깨진다.
 */
async function loadSync(token: string | undefined) {
  vi.resetModules();
  vi.doMock("@/shared/config/env", async () => {
    const actual = await vi.importActual<typeof import("@/shared/config/env")>(
      "@/shared/config/env",
    );
    return {
      ...actual,
      env: { ...actual.env, GITHUB_MONITOR_TOKEN: token, GITHUB_MONITOR_ORG: "krdn" },
    };
  });
  return (await import("@/features/github-monitor")).syncGithub;
}

/** GitHub API 응답을 경로 패턴별로 지정하는 fetch mock. */
function mockFetchByPath(routes: { match: RegExp; status?: number; body: unknown }[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const route = routes.find((r) => r.match.test(url));
    if (route == null) {
      return new Response(JSON.stringify({ message: "unmatched" }), { status: 404 });
    }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  });
}

const EMPTY_SEARCH = { total_count: 0, incomplete_results: false, items: [] };

async function seedIssue() {
  await db.insert(githubIssues).values({
    id: "krdn/a#1", repo: "krdn/a", number: 1, title: "t", url: "u",
    author: null, labels: [], createdAt: new Date(), updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(githubIssues);
  await db.delete(githubWorkflowRuns);
  await db.delete(githubSyncState);
  await db.delete(monitoringEvents);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/shared/config/env");
  vi.resetModules();
});

describe("syncGithub — 토큰 미설정", () => {
  it("skip 하고 기존 행을 지우지 않는다", async () => {
    await seedIssue();
    const syncGithub = await loadSync(undefined);
    const summary = await syncGithub();

    expect(summary.skipped).toBe(true);
    expect(await db.select().from(githubIssues)).toHaveLength(1);
  });

  // §4.2 규칙 5 — "시도는 하고 있다"를 남겨야 보드가 비활성과
  // 완전 정지를 구분할 수 있다.
  it("네 소스의 lastAttemptAt 을 갱신한다", async () => {
    const syncGithub = await loadSync(undefined);
    await syncGithub();

    const rows = await db.select().from(githubSyncState);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.lastAttemptAt != null)).toBe(true);
    expect(rows.every((r) => r.lastSuccessAt == null)).toBe(true);
  });
});

describe("syncGithub — API 실패", () => {
  it("기존 이슈 행을 삭제하지 않는다", async () => {
    await seedIssue();
    mockFetchByPath([{ match: /./, status: 429, body: { message: "rate limited" } }]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.issues.ok).toBe(false);
    expect(await db.select().from(githubIssues)).toHaveLength(1);
  });

  // 회귀 가드 5: API 실패에서 판정·해소가 일어나면
  // Build 가 계속 실패 중인데 "복구됨" 알림이 나간다.
  it("build 판정을 건너뛰고 기존 open 이벤트를 유지한다", async () => {
    await db.insert(monitoringEvents).values({
      source: "github",
      severity: "critical",
      title: "Build 실패",
      dedupKey: BUILD_DEDUP,
    });
    mockFetchByPath([{ match: /./, status: 500, body: { message: "boom" } }]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.ok).toBe(false);
    expect(summary.build.state).toBeNull();

    const events = await db.select().from(monitoringEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.resolvedAt).toBeNull(); // 해소되지 않았다
  });

  // 회귀 가드 7: 부분 결과로 교체하면 멀쩡한 항목이 사라진다.
  it("incomplete_results 면 이슈 스냅샷을 교체하지 않는다", async () => {
    await seedIssue();
    mockFetchByPath([
      {
        // ⚠️ encodeURIComponent 가 "is:issue" 를 "is%3Aissue" 로 바꾼다.
        // 원문으로 매칭하면 폴백 라우트에 걸려 정상 응답이 돌아오고,
        // 이 테스트가 아무것도 검증하지 못한 채 통과한다.
        match: /search\/issues.*is%3Aissue/,
        body: { total_count: 1, incomplete_results: true, items: [{ id: 99 }] },
      },
      { match: /./, body: EMPTY_SEARCH },
    ]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.issues.ok).toBe(false);
    const rows = await db.select().from(githubIssues);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("krdn/a#1"); // 기존 행 그대로
  });
});

describe("syncGithub — 성공 경로", () => {
  const HEAD_SHA = "aaaaaaaabbbbbbbb";

  function buildRoutes(conclusion: string) {
    return [
      { match: /search\/issues/, body: EMPTY_SEARCH },
      { match: /orgs\/krdn\/repos/, body: [] },
      {
        match: /commits\/main/,
        body: {
          sha: HEAD_SHA,
          // 유예(10분)를 넘긴 과거 커밋 — no-run 판정이 살아있게 한다
          commit: { committer: { date: new Date(Date.now() - 3_600_000).toISOString() } },
        },
      },
      {
        match: /actions\/workflows/,
        body: {
          workflow_runs: [
            {
              id: 1, name: "CI", workflow_id: 1, path: ".github/workflows/ci.yml",
              status: "completed", conclusion, head_sha: HEAD_SHA, head_branch: "main",
              event: "push", run_number: 1, run_attempt: 1,
              html_url: "https://gh/run/1",
              run_started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
      },
      { match: /actions\/runs/, body: { workflow_runs: [] } },
    ];
  }

  it("build 실패 시 critical 이벤트를 발행한다", async () => {
    mockFetchByPath(buildRoutes("failure"));
    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.state).toBe("build-failed");
    const events = await db.select().from(monitoringEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.severity).toBe("critical");
    expect(events[0]?.dedupKey).toBe(BUILD_DEDUP);
  });

  it("build 성공 시 기존 open 이벤트를 해소한다", async () => {
    await db.insert(monitoringEvents).values({
      source: "github", severity: "critical", title: "Build 실패", dedupKey: BUILD_DEDUP,
    });
    mockFetchByPath(buildRoutes("success"));

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.state).toBe("synced");
    const events = await db.select().from(monitoringEvents);
    expect(events[0]?.resolvedAt).not.toBeNull();
  });

  // building·no-run·unknown 은 no-op — 확인되지 않은 상태에서
  // 해소하면 거짓 안심을 준다.
  it("build 진행 중이면 기존 이벤트를 해소하지 않는다", async () => {
    await db.insert(monitoringEvents).values({
      source: "github", severity: "critical", title: "Build 실패", dedupKey: BUILD_DEDUP,
    });
    mockFetchByPath([
      ...buildRoutes("success").filter((r) => !/actions\/workflows/.test(r.match.source)),
      {
        match: /actions\/workflows/,
        body: {
          workflow_runs: [
            {
              id: 2, name: "CI", workflow_id: 1, path: ".github/workflows/ci.yml",
              status: "in_progress", conclusion: null, head_sha: HEAD_SHA,
              head_branch: "main", event: "push", run_number: 2, run_attempt: 1,
              html_url: "https://gh/run/2",
              run_started_at: new Date().toISOString(), updated_at: null,
            },
          ],
        },
      },
    ]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.state).toBe("building");
    const events = await db.select().from(monitoringEvents);
    expect(events[0]?.resolvedAt).toBeNull();
  });
});

describe("syncGithub — Actions 부분 실패", () => {
  // 회귀 가드 8: 성공한 레포는 갱신되지만 lastSuccessAt 은 갱신되지 않는다(§4.3).
  it("실패 레포의 run 은 유지하고 lastSuccessAt 을 갱신하지 않는다", async () => {
    await db.insert(githubWorkflowRuns).values({
      id: "old-b", repo: "krdn/b", workflowId: "wf", workflowName: "CI",
      status: "completed", conclusion: "success", headSha: "s", headBranch: "main",
      event: "push", runNumber: 1, runAttempt: 1, url: "u",
      startedAt: new Date(), completedAt: new Date(),
    });

    mockFetchByPath([
      { match: /search\/issues/, body: EMPTY_SEARCH },
      { match: /commits\/main/, body: { sha: "x", commit: { committer: { date: new Date().toISOString() } } } },
      { match: /actions\/workflows/, body: { workflow_runs: [] } },
      {
        match: /orgs\/krdn\/repos/,
        body: [
          { full_name: "krdn/a", pushed_at: new Date().toISOString() },
          { full_name: "krdn/b", pushed_at: new Date().toISOString() },
        ],
      },
      // krdn/b 만 실패시킨다
      { match: /repos\/krdn\/b\/actions\/runs/, status: 500, body: { message: "boom" } },
      {
        match: /repos\/krdn\/a\/actions\/runs/,
        body: {
          workflow_runs: [
            {
              id: 10, name: "CI", workflow_id: 1, path: "p", status: "completed",
              conclusion: "success", head_sha: "s", head_branch: "main", event: "push",
              run_number: 1, run_attempt: 1, html_url: "u",
              run_started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            },
          ],
        },
      },
    ]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.runs.ok).toBe(false);
    expect(summary.runs.failedRepos).toContain("krdn/b");

    // 실패한 레포의 이전 run 은 살아있다
    const runs = await db.select().from(githubWorkflowRuns);
    expect(runs.some((r) => r.id === "old-b")).toBe(true);
    // 성공한 레포는 갱신됐다
    expect(runs.some((r) => r.id === "10")).toBe(true);

    const runsState = (await db.select().from(githubSyncState)).find((s) => s.source === "runs");
    expect(runsState?.lastSuccessAt).toBeNull();
    expect(runsState?.lastError).toContain("krdn/b");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run tests/integration/github-sync-orchestration.test.ts
```

Expected: FAIL — `@/features/github-monitor` 없음.

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/features/github-monitor/index.ts`:

```ts
// GitHub 동기화 오케스트레이션 — server entrypoint (이슈 #323).
//
// 소스별로 독립 수행한다. 한 소스가 실패해도 다른 소스는 각자 교체된다(§4.2).
// 실패한 소스는 스냅샷을 건드리지 않고 lastError 만 기록한다.
import "server-only";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";
import { recordEvent, resolveEvent } from "@/entities/monitoring/server";
import {
  replaceIssues,
  replacePrs,
  replaceRunsForRepo,
  upsertSyncState,
} from "@/entities/github-activity/server";
import { type BuildState } from "@/entities/github-activity/client";
import {
  searchIssues,
  listActiveRepos,
  listWorkflowRuns,
  listBuildRuns,
  getMainHead,
  getPullHeadSha,
  type RawSearchItem,
  type RawRun,
} from "./lib/githubClient";
import { judgeBuildState } from "./lib/judgeBuildState";
import { BUILD_REPO, BUILD_WORKFLOW_PATH, PR_HEAD_FETCH_LIMIT } from "./config/thresholds";

export interface SyncSummary {
  skipped: boolean;
  issues: { ok: boolean; count: number; error?: string };
  pulls: { ok: boolean; count: number; error?: string };
  runs: { ok: boolean; repos: number; failedRepos: string[] };
  build: { ok: boolean; state: BuildState | null; error?: string };
}

const BUILD_DEDUP_KEY = `github:${BUILD_REPO}:build-failed`;

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/** repository_url("https://api.github.com/repos/krdn/a") → "krdn/a" */
function repoFromUrl(url: string): string {
  return url.split("/repos/")[1] ?? "unknown";
}

function toRunRow(repo: string, r: RawRun) {
  return {
    id: String(r.id),
    repo,
    // path 가 없으면 workflow_id 로 폴백 — 둘 다 이름보다 안정적이다.
    workflowId: r.path ?? String(r.workflow_id),
    workflowName: r.name ?? "(이름 없음)",
    status: r.status,
    conclusion: r.conclusion,
    headSha: r.head_sha,
    headBranch: r.head_branch,
    event: r.event,
    runNumber: r.run_number,
    runAttempt: r.run_attempt,
    url: r.html_url,
    startedAt: r.run_started_at == null ? null : new Date(r.run_started_at),
    completedAt: r.updated_at == null ? null : new Date(r.updated_at),
  };
}

function toIssueRow(item: RawSearchItem) {
  const repo = repoFromUrl(item.repository_url);
  return {
    id: `${repo}#${item.number}`,
    repo,
    number: item.number,
    title: item.title,
    url: item.html_url,
    author: item.user?.login ?? null,
    labels: item.labels.map((l) => l.name),
    createdAt: new Date(item.created_at),
    updatedAt: new Date(item.updated_at),
  };
}

async function syncIssues(token: string, org: string): Promise<SyncSummary["issues"]> {
  const now = new Date();
  await upsertSyncState("issues", { lastAttemptAt: now });
  try {
    const { items, totalCount, truncated } = await searchIssues(token, org, "issue");
    await replaceIssues(items.map(toIssueRow));
    await upsertSyncState("issues", {
      lastSuccessAt: now,
      lastError: null,
      totalCount,
      truncated,
    });
    return { ok: true, count: items.length };
  } catch (err) {
    const error = errMsg(err);
    await upsertSyncState("issues", { lastError: error });
    return { ok: false, count: 0, error };
  }
}

async function syncPulls(token: string, org: string): Promise<SyncSummary["pulls"]> {
  const now = new Date();
  await upsertSyncState("pulls", { lastAttemptAt: now });
  try {
    const { items, totalCount, truncated } = await searchIssues(token, org, "pr");

    // Search 응답에는 head.sha 가 없어 상한까지 개별 조회한다.
    // 초과분·조회 실패는 headSha null → CI 상태 unknown 으로 떨어진다.
    const rows = await Promise.all(
      items.map(async (item, idx) => {
        const repo = repoFromUrl(item.repository_url);
        let headSha: string | null = null;
        if (idx < PR_HEAD_FETCH_LIMIT) {
          try {
            headSha = await getPullHeadSha(token, repo, item.number);
          } catch {
            headSha = null;
          }
        }
        return {
          id: `${repo}#${item.number}`,
          repo,
          number: item.number,
          title: item.title,
          url: item.html_url,
          author: item.user?.login ?? null,
          isDraft: item.draft ?? false,
          headSha,
          createdAt: new Date(item.created_at),
          updatedAt: new Date(item.updated_at),
        };
      }),
    );

    await replacePrs(rows);
    await upsertSyncState("pulls", {
      lastSuccessAt: now,
      lastError: null,
      totalCount,
      truncated,
    });
    return { ok: true, count: rows.length };
  } catch (err) {
    const error = errMsg(err);
    await upsertSyncState("pulls", { lastError: error });
    return { ok: false, count: 0, error };
  }
}

async function syncRuns(token: string, org: string): Promise<SyncSummary["runs"]> {
  const now = new Date();
  await upsertSyncState("runs", { lastAttemptAt: now });

  let repos: string[];
  try {
    repos = await listActiveRepos(token, org);
  } catch (err) {
    await upsertSyncState("runs", { lastError: errMsg(err) });
    return { ok: false, repos: 0, failedRepos: [] };
  }

  const failedRepos: string[] = [];
  for (const repo of repos) {
    try {
      const runs = await listWorkflowRuns(token, repo);
      await replaceRunsForRepo(repo, runs.map((r) => toRunRow(repo, r)));
    } catch {
      // 이 레포의 이전 run 은 그대로 유지된다 (§4.2 규칙 2).
      failedRepos.push(repo);
    }
  }

  if (failedRepos.length > 0) {
    // 부분 실패 — lastSuccessAt 은 갱신하지 않는다 (§4.3).
    await upsertSyncState("runs", {
      lastError: `${failedRepos.length}개 레포 실패: ${failedRepos.join(", ")}`.slice(0, 200),
    });
    return { ok: false, repos: repos.length, failedRepos };
  }

  await upsertSyncState("runs", { lastSuccessAt: now, lastError: null });
  return { ok: true, repos: repos.length, failedRepos: [] };
}

async function syncBuild(token: string, nowFn: () => Date): Promise<SyncSummary["build"]> {
  const now = nowFn();
  await upsertSyncState("build", { lastAttemptAt: now });

  let head: { sha: string; committedAt: Date };
  let runs: RawRun[];
  try {
    head = await getMainHead(token, BUILD_REPO);
    runs = await listBuildRuns(token, BUILD_REPO, BUILD_WORKFLOW_PATH);
  } catch (err) {
    // ⚠️ 판정 자체를 수행하지 않는다. 관측 불가에서 판정하면
    // Build 가 계속 실패 중인데 "복구됨" 알림이 나간다.
    const error = errMsg(err);
    await upsertSyncState("build", { lastError: error });
    return { ok: false, state: null, error };
  }

  const { state, run } = judgeBuildState({
    mainHeadSha: head.sha,
    mainHeadCommittedAt: head.committedAt,
    runs: runs.map((r) => toRunRow(BUILD_REPO, r)),
    nowFn,
  });

  await upsertSyncState("build", {
    lastSuccessAt: now,
    lastError: null,
    buildState: state,
    mainHeadSha: head.sha,
    mainHeadCommittedAt: head.committedAt,
    buildRunUrl: run?.url ?? null,
    buildConclusion: run?.conclusion ?? null,
  });

  // 관측은 best-effort — 이벤트 발행 실패가 동기화를 실패시키면 안 된다.
  try {
    if (state === "build-failed") {
      await recordEvent({
        source: "github",
        severity: "critical",
        title: `${BUILD_REPO} main Build 실패`,
        detail: JSON.stringify({ sha: head.sha.slice(0, 7), url: run?.url ?? null }),
        dedupKey: BUILD_DEDUP_KEY,
      });
    } else if (state === "synced") {
      // synced 일 때만 해소한다. building·no-run·unknown 은 no-op —
      // 확인되지 않은 상태에서 해소하면 거짓 안심을 준다.
      await resolveEvent(BUILD_DEDUP_KEY);
    }
  } catch (err) {
    logger.warn("github-monitor", "build-event-record-failed", { error: errMsg(err) });
  }

  return { ok: true, state };
}

const ALL_SOURCES = ["issues", "pulls", "runs", "build"] as const;

export async function syncGithub(opts?: { nowFn?: () => Date }): Promise<SyncSummary> {
  const token = env.GITHUB_MONITOR_TOKEN;
  const nowFn = opts?.nowFn ?? (() => new Date());

  if (token == null || token === "") {
    // 기존 스냅샷을 지우지 않는다 — 보드는 "동기화 비활성" 배지를 표시한다.
    // lastAttemptAt 은 갱신해 "시도는 하고 있다"를 남긴다 (§4.2 규칙 5).
    logger.info("github-monitor", "token-not-configured", {});
    const now = nowFn();
    for (const source of ALL_SOURCES) {
      await upsertSyncState(source, { lastAttemptAt: now });
    }
    return {
      skipped: true,
      issues: { ok: false, count: 0 },
      pulls: { ok: false, count: 0 },
      runs: { ok: false, repos: 0, failedRepos: [] },
      build: { ok: false, state: null },
    };
  }

  const org = env.GITHUB_MONITOR_ORG;

  const [issues, pulls, runs, build] = await Promise.all([
    syncIssues(token, org),
    syncPulls(token, org),
    syncRuns(token, org),
    syncBuild(token, nowFn),
  ]);

  return { skipped: false, issues, pulls, runs, build };
}
```

- [ ] **Step 4: EventSource 에 "github" 추가**

Modify `apps/dashboard/src/entities/monitoring/model/types.ts` — `EventSource` 유니온의 `| "http";` 를 다음으로 교체:

```ts
  | "http"
  | "github";
```

- [ ] **Step 5: 스키마 주석 갱신**

Modify `apps/dashboard/src/shared/lib/db/schema/monitoring.ts` — `monitoringEvents` 의 source 주석 줄을 교체:

```ts
    // 'host' | 'container' | 'cron' | 'service' | 'security' | 'ssl' | 'http' | 'github'
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run tests/integration/github-sync-orchestration.test.ts
```

Expected: PASS — 9개 케이스 전부 통과.

- [ ] **Step 7: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/index.ts \
        apps/dashboard/src/entities/monitoring/model/types.ts \
        apps/dashboard/src/shared/lib/db/schema/monitoring.ts \
        apps/dashboard/tests/integration/github-sync-orchestration.test.ts
git commit -m "feat(monitoring): GitHub 동기화 오케스트레이션 (#323)

소스별 독립 수행 — 한 소스가 실패해도 나머지는 각자 교체된다.
API 실패 시 build 판정 자체를 건너뛴다: 관측 불가에서 해소하면
Build 가 계속 실패 중인데 복구됨 알림이 나간다."
```

---

## Task 12: cron 라우트 + 스케줄 등록

**Files:**
- Create: `apps/dashboard/src/app/api/cron/github-sync/route.ts`
- Modify: `apps/cron/scheduler.js` (파일 끝의 마지막 `cron.schedule` 블록 뒤)

**Interfaces:**
- Consumes: Task 11 `syncGithub`
- Produces: `POST /api/cron/github-sync` — createCronHandler envelope 응답

- [ ] **Step 1: cron 라우트 작성**

Create `apps/dashboard/src/app/api/cron/github-sync/route.ts`:

```ts
// 5분마다 — GitHub 이슈·PR·Actions 스냅샷 동기화 (이슈 #323).
// 수집 잡이므로 놓친 주기는 다음 5분이 대체한다 — catchup·retry 없음.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { syncGithub, type SyncSummary } from "@/features/github-monitor";

export const dynamic = "force-dynamic";

// 단일 대상 cron — 소스별 격리는 syncGithub 내부가 담당한다.
const TARGETS = [{ id: "github" }] as const;

/** 실패한 소스 이름 목록. 비어 있으면 전 소스 성공. */
function failedSources(summary: SyncSummary): string[] {
  const failed: string[] = [];
  if (!summary.issues.ok) failed.push("issues");
  if (!summary.pulls.ok) failed.push("pulls");
  if (!summary.runs.ok) failed.push("runs");
  if (!summary.build.ok) failed.push("build");
  return failed;
}

export const POST = createCronHandler({
  name: "github-sync",
  targetSelect: async () => [...TARGETS],
  getId: (t) => t.id,
  perTarget: async () => {
    const summary = await syncGithub();

    // ⚠️ createCronHandler 는 perTarget 이 throw 해야 cron_runs 를 실패로
    // 기록한다. summary 를 그대로 반환하면 전 소스가 실패해도 status=ok 로
    // 남아 관제의 수집기 자체가 관측 불가가 된다.
    //
    // 토큰 미설정(skipped)은 실패가 아니다 — 의도적 비활성이므로 ok 로 둔다.
    if (!summary.skipped) {
      const failed = failedSources(summary);
      if (failed.length > 0) {
        throw new Error(`GitHub 동기화 부분 실패: ${failed.join(", ")}`);
      }
    }

    return summary as unknown as Record<string, unknown>;
  },
});
```

**설계 판단**: 소스 하나만 실패해도 cron 전체를 실패로 기록한다. 성공한 소스의
스냅샷은 이미 DB 에 반영됐고 `github_sync_state` 가 소스별 진실을 갖고 있으므로,
cron 상태는 "손볼 곳이 있다"는 단일 신호로 쓰는 편이 낫다. 소스별 세부는
보드의 배지가 보여준다.

- [ ] **Step 2: 타입 체크**

```bash
cd apps/dashboard
pnpm typecheck
```

Expected: 에러 없음. `createCronHandler` 의 제네릭이 맞지 않는다는 에러가 나면 `perTarget` 의 반환 타입을 정의부에 맞게 조정한다(`CronHandlerDefinition<TTarget, TPayload>` 참조).

- [ ] **Step 3: 스케줄 등록**

Modify `apps/cron/scheduler.js` — 파일의 마지막 `cron.schedule(...)` 블록 **뒤**에 추가:

```js
// 5분마다 — GitHub 이슈·PR·Actions 스냅샷 동기화 (관제 #323).
// 수집 잡: 놓친 주기는 다음 5분이 대체 — catchup·retry 제외.
cron.schedule(
  "*/5 * * * *",
  () => {
    void callCron("/api/cron/github-sync", "github-sync", 120_000);
  },
  { timezone: TIMEZONE },
);
```

- [ ] **Step 4: 스케줄러 문법 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard
node --check apps/cron/scheduler.js
```

Expected: 출력 없음 (문법 정상).

- [ ] **Step 5: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/app/api/cron/github-sync/route.ts apps/cron/scheduler.js
git commit -m "feat(monitoring): github-sync cron 라우트·스케줄 등록 (#323)

5분 주기 수집 잡. 놓친 주기는 다음 회차가 대체하므로 catchup 없음."
```

---

## Task 13: 탭 셸 (layout + MonitoringTabs)

**Files:**
- Create: `apps/dashboard/src/widgets/monitoring/ui/MonitoringTabs.tsx`
- Create: `apps/dashboard/src/app/(dashboard)/monitoring/layout.tsx`
- Modify: `apps/dashboard/src/widgets/monitoring/index.ts` (export 추가)
- Test: `apps/dashboard/src/widgets/monitoring/ui/MonitoringTabs.test.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: `MonitoringTabs` — `usePathname()` 으로 활성 탭을 판정하는 client 컴포넌트

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/src/widgets/monitoring/ui/MonitoringTabs.test.tsx`:

```tsx
// @vitest-environment jsdom
// ⚠️ 이 지시자가 없으면 vitest 기본 환경(node)에서 document 가 없어
// Testing Library 가 즉시 죽는다 (vitest.config.ts 의 environment: "node").
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonitoringTabs } from "./MonitoringTabs";

const mockPathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("MonitoringTabs", () => {
  it("두 탭을 렌더한다", () => {
    mockPathname.mockReturnValue("/monitoring");
    render(<MonitoringTabs />);
    expect(screen.getByRole("link", { name: "인프라" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "GitHub" })).toBeTruthy();
  });

  it("/monitoring 에서는 인프라 탭이 활성", () => {
    mockPathname.mockReturnValue("/monitoring");
    render(<MonitoringTabs />);
    expect(screen.getByRole("link", { name: "인프라" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("aria-current")).toBeNull();
  });

  // 하위 경로에서 인프라 탭이 활성으로 남으면 안 된다 (prefix 매칭 함정).
  it("/monitoring/github 에서는 GitHub 탭만 활성", () => {
    mockPathname.mockReturnValue("/monitoring/github");
    render(<MonitoringTabs />);
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "인프라" }).getAttribute("aria-current")).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/widgets/monitoring/ui/MonitoringTabs.test.tsx
```

Expected: FAIL — import 해결 실패.

`document is not defined` 가 나오면 파일 첫 줄의 `// @vitest-environment jsdom` 이 빠진 것이다.
`No test files found` 가 나오면 include 문제인데, 현재 `vitest.config.ts` 는
`src/**/*.test.tsx` 를 포함하므로 정상적으로는 발생하지 않는다.

- [ ] **Step 3: 최소 구현 작성**

Create `apps/dashboard/src/widgets/monitoring/ui/MonitoringTabs.tsx`:

```tsx
"use client";

// /monitoring 탭 셸 — 인프라 | GitHub (이슈 #323).
//
// nav 트리(shared/config/navigation.ts)는 건드리지 않는다. 관제는 고빈도
// operational 조회라 top-level leaf 로 유지하고, 하위 구분만 여기서 한다.
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/monitoring", label: "인프라" },
  { href: "/monitoring/github", label: "GitHub" },
] as const;

export function MonitoringTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-[var(--color-hairline)]">
      {TABS.map((tab) => {
        // 정확 일치 — prefix 매칭을 쓰면 /monitoring/github 에서
        // 인프라 탭까지 활성으로 남는다.
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "border-b-2 border-[var(--color-accent)] px-4 py-2 text-sm font-semibold"
                : "px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: 배럴에 export 추가**

Modify `apps/dashboard/src/widgets/monitoring/index.ts` — 파일 끝에 추가:

```ts
export { MonitoringTabs } from "./ui/MonitoringTabs";
```

- [ ] **Step 5: layout 작성**

Create `apps/dashboard/src/app/(dashboard)/monitoring/layout.tsx`:

```tsx
// /monitoring 공통 셸 — 탭만 담당한다.
//
// ⚠️ 인증은 여기가 아니라 각 page.tsx 에서 한다. layout 인증은 Next 에서
// 라우트별 보호를 보장하지 않는다.
import { MonitoringTabs } from "@/widgets/monitoring";

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MonitoringTabs />
      {children}
    </>
  );
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/widgets/monitoring/ui/MonitoringTabs.test.tsx
```

Expected: PASS — "3 passed" 를 **눈으로 확인**할 것. "0 passed" 나 "No test files" 면 include 문제다.

- [ ] **Step 7: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/widgets/monitoring/ui/MonitoringTabs.tsx \
        apps/dashboard/src/widgets/monitoring/ui/MonitoringTabs.test.tsx \
        apps/dashboard/src/widgets/monitoring/index.ts \
        'apps/dashboard/src/app/(dashboard)/monitoring/layout.tsx'
git commit -m "feat(monitoring): /monitoring 탭 셸 추가 (#323)

nav 트리는 그대로 두고 하위 구분만 탭으로 한다 — 관제는 고빈도
조회라 top-level leaf 를 유지해야 원클릭 접근이 살아있다.
활성 판정은 정확 일치 — prefix 면 하위 경로에서 두 탭이 다 켜진다."
```

---

## Task 14: GitHub 보드 위젯

**Files:**
- Create: `apps/dashboard/src/features/github-monitor/lib/index.ts`
- Create: `apps/dashboard/src/widgets/monitoring/ui/SyncStateBadge.tsx`
- Create: `apps/dashboard/src/widgets/monitoring/ui/BuildStateCard.tsx`
- Create: `apps/dashboard/src/widgets/monitoring/ui/GithubBoards.tsx`
- Modify: `apps/dashboard/src/widgets/monitoring/index.ts`
- Test: `apps/dashboard/src/widgets/monitoring/ui/GithubBoards.test.tsx`

**Interfaces:**
- Consumes:
  - Task 3 타입 (`@/entities/github-activity/client`)
  - Step 0 배럴이 재export 하는 판정 함수 — `normalizeRunOutcome`(Task 2), `judgeBuildState`(Task 4), `derivePrCiStatus`(Task 6), `isPrStale`·`isIssueTriageStale`·`deriveSyncDisplayState`(Task 7). **이 네 태스크가 모두 끝나야 Step 0 이 컴파일된다.**
- Produces:
  - `@/features/github-monitor/lib` 배럴 — 위 판정 함수 전부. Task 15 가 이 경로로 import 한다.
  - 위젯 (전부 `@/widgets/monitoring` 배럴에서):
    - `SyncStateBadge({ state, detail? }: { state: SyncDisplayState; detail?: string | null })`
    - `BuildStateCard({ build }: { build: GithubSyncState | null })`
    - `WorkflowRunsBoard({ runs }: { runs: GithubWorkflowRun[] })`
    - `PullRequestsBoard({ prs, ciStatus, staleIds }: { prs: GithubPullRequest[]; ciStatus: Record<string, PrCiStatus>; staleIds: Set<string> })`
    - `IssuesBoard({ issues, staleIds }: { issues: GithubIssue[]; staleIds: Set<string> })`

- [ ] **Step 0: 판정 함수 재export 배럴 작성**

Create `apps/dashboard/src/features/github-monitor/lib/index.ts`:

```ts
// 판정 순수 함수 재export — 소비자가 개별 파일 경로를 몰라도 되게 한다.
//
// features/github-monitor/index.ts(server entrypoint)와 분리한 이유:
// 이 함수들은 DB·네트워크 의존이 없어 fetch/postgres 를 끌어오지 않는다.
//
// ⚠️ 다만 "client 안전"은 아니다. normalizeRunOutcome 이 shared/lib/log 를
// import 하고 그 모듈은 `import "server-only"` 다. 따라서 이 배럴은
// **서버 트리 전용**(RSC·API route·cron·서버 렌더 위젯)이다.
// "use client" 컴포넌트에서 판정이 필요해지면 logger 의존을 걷어내거나
// client 전용 변형을 따로 두어야 한다.
export { normalizeRunOutcome, type RunOutcome } from "./normalizeRunOutcome";
export { judgeBuildState } from "./judgeBuildState";
export { derivePrCiStatus } from "./derivePrCiStatus";
export { isPrStale, isIssueTriageStale, deriveSyncDisplayState } from "./judgeStaleness";
```

- [ ] **Step 1: 배지 컴포넌트 작성**

Create `apps/dashboard/src/widgets/monitoring/ui/SyncStateBadge.tsx`:

```tsx
// 동기화 상태 배지 — "데이터 없음"과 "동기화가 죽어 낡음"을 구분해 보여준다.
import { type SyncDisplayState } from "@/entities/github-activity/client";

const LABEL: Record<SyncDisplayState, string | null> = {
  "disabled-empty": "동기화 비활성",
  "disabled-stale": "동기화 비활성 (이전 데이터)",
  error: "동기화 오류",
  empty: "아직 동기화된 적 없음",
  stale: "데이터 낡음",
  ok: null,
};

const TONE: Record<SyncDisplayState, string> = {
  "disabled-empty": "bg-neutral-100 text-neutral-600",
  "disabled-stale": "bg-neutral-100 text-neutral-600",
  error: "bg-red-100 text-red-700",
  empty: "bg-neutral-100 text-neutral-600",
  stale: "bg-amber-100 text-amber-700",
  ok: "",
};

export function SyncStateBadge({
  state,
  detail,
}: {
  state: SyncDisplayState;
  detail?: string | null;
}) {
  const label = LABEL[state];
  if (label == null) return null;
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${TONE[state]}`} title={detail ?? undefined}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Build 카드 작성**

Create `apps/dashboard/src/widgets/monitoring/ui/BuildStateCard.tsx`:

```tsx
// 배포 파이프라인 히어로 카드 — 이 관제의 핵심 가치.
//
// main 에 머지했는데 Build 가 실패하면 ghcr 에 이미지가 안 올라가고
// deploy-watcher 는 조용히 넘어간다. 그 상태를 여기서 드러낸다.
import { type BuildState, type GithubSyncState } from "@/entities/github-activity/client";

const STATE_LABEL: Record<BuildState, string> = {
  synced: "빌드 성공",
  building: "빌드 진행 중",
  "build-failed": "빌드 실패",
  "no-run": "실행 없음",
  unknown: "판정 불가",
};

const STATE_TONE: Record<BuildState, string> = {
  synced: "text-emerald-700",
  building: "text-blue-700",
  "build-failed": "text-red-700",
  "no-run": "text-amber-700",
  unknown: "text-neutral-500",
};

export function BuildStateCard({ build }: { build: GithubSyncState | null }) {
  const state = build?.buildState ?? null;

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <p className="text-xs text-[var(--color-text-muted)]">main 브랜치 빌드</p>
      {state == null ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">아직 판정된 적 없음</p>
      ) : (
        <>
          <p className={`mt-1 text-2xl font-bold ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-[var(--color-text-muted)]">HEAD</dt>
              <dd className="font-mono">{build?.mainHeadSha?.slice(0, 7) ?? "—"}</dd>
            </div>
            {build?.buildRunUrl != null && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-text-muted)]">실행</dt>
                <dd>
                  <a
                    href={build.buildRunUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    GitHub 에서 보기
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 드릴다운 표 작성**

Create `apps/dashboard/src/widgets/monitoring/ui/GithubBoards.tsx`:

```tsx
// GitHub 드릴다운 표 3개 — Actions / PR / 이슈.
// 각 행은 GitHub 원본으로 링크한다. 보드는 전수 목록이 아니라 판단 도구다.
import { normalizeRunOutcome } from "@/features/github-monitor/lib";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubWorkflowRun,
  type PrCiStatus,
} from "@/entities/github-activity/client";

const MAX_ROWS = 20;

const CI_LABEL: Record<PrCiStatus, string> = {
  passing: "통과",
  failing: "실패",
  running: "진행 중",
  unknown: "—",
};

const CI_TONE: Record<PrCiStatus, string> = {
  passing: "text-emerald-700",
  failing: "text-red-700",
  running: "text-blue-700",
  unknown: "text-neutral-400",
};

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <h2 className="text-sm font-semibold">
        {title} <span className="text-[var(--color-text-muted)]">({count})</span>
      </h2>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-4 text-sm text-[var(--color-text-muted)]">{label}</p>;
}

export function WorkflowRunsBoard({ runs }: { runs: GithubWorkflowRun[] }) {
  // 실패를 위로 — 판단이 필요한 것부터 보여준다.
  // ⚠️ conclusion === "failure" 만 보면 timed_out·startup_failure 가 빠진다.
  const isFail = (r: GithubWorkflowRun) => normalizeRunOutcome(r) === "failure";
  const sorted = [...runs].sort((a, b) => {
    const d = (isFail(a) ? 0 : 1) - (isFail(b) ? 0 : 1);
    if (d !== 0) return d;
    return (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0);
  });

  return (
    <Section title="Actions 실행" count={runs.length}>
      {sorted.length === 0 ? (
        <Empty label="표시할 실행이 없습니다." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-muted)]">
              <th className="py-1">레포</th>
              <th>워크플로</th>
              <th>상태</th>
              <th>브랜치</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, MAX_ROWS).map((r) => (
              <tr key={r.id} className="border-t border-[var(--color-hairline)]">
                <td className="py-1">{r.repo}</td>
                <td>
                  <a href={r.url} target="_blank" rel="noreferrer" className="underline">
                    {r.workflowName}
                  </a>
                </td>
                <td className={isFail(r) ? "text-red-700" : ""}>{r.conclusion ?? r.status}</td>
                <td className="font-mono text-xs">{r.headBranch ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function PullRequestsBoard({
  prs,
  ciStatus,
  staleIds,
}: {
  prs: GithubPullRequest[];
  ciStatus: Record<string, PrCiStatus>;
  staleIds: Set<string>;
}) {
  return (
    <Section title="열린 PR" count={prs.length}>
      {prs.length === 0 ? (
        <Empty label="열린 PR 이 없습니다." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-muted)]">
              <th className="py-1">레포</th>
              <th>제목</th>
              <th>CI</th>
              <th>작성자</th>
            </tr>
          </thead>
          <tbody>
            {prs.slice(0, MAX_ROWS).map((pr) => {
              const ci = ciStatus[pr.id] ?? "unknown";
              return (
                <tr key={pr.id} className="border-t border-[var(--color-hairline)]">
                  <td className="py-1">{pr.repo}</td>
                  <td>
                    <a href={pr.url} target="_blank" rel="noreferrer" className="underline">
                      {pr.title}
                    </a>
                    {pr.isDraft && (
                      <span className="ml-1 text-xs text-[var(--color-text-muted)]">draft</span>
                    )}
                    {staleIds.has(pr.id) && (
                      <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">
                        정체
                      </span>
                    )}
                  </td>
                  <td className={CI_TONE[ci]}>{CI_LABEL[ci]}</td>
                  <td>{pr.author ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function IssuesBoard({
  issues,
  staleIds,
}: {
  issues: GithubIssue[];
  staleIds: Set<string>;
}) {
  // 정체된 것을 위로.
  const sorted = [...issues].sort((a, b) => {
    const aStale = staleIds.has(a.id) ? 0 : 1;
    const bStale = staleIds.has(b.id) ? 0 : 1;
    if (aStale !== bStale) return aStale - bStale;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return (
    <Section title="열린 이슈" count={issues.length}>
      {sorted.length === 0 ? (
        <Empty label="열린 이슈가 없습니다." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-muted)]">
              <th className="py-1">레포</th>
              <th>제목</th>
              <th>라벨</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, MAX_ROWS).map((issue) => (
              <tr key={issue.id} className="border-t border-[var(--color-hairline)]">
                <td className="py-1">{issue.repo}</td>
                <td>
                  <a href={issue.url} target="_blank" rel="noreferrer" className="underline">
                    {issue.title}
                  </a>
                  {staleIds.has(issue.id) && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">
                      정체
                    </span>
                  )}
                </td>
                <td className="text-xs">{issue.labels.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
```

- [ ] **Step 4: 배럴에 export 추가**

Modify `apps/dashboard/src/widgets/monitoring/index.ts` — 파일 끝에 추가:

```ts
export { SyncStateBadge } from "./ui/SyncStateBadge";
export { BuildStateCard } from "./ui/BuildStateCard";
export { WorkflowRunsBoard, PullRequestsBoard, IssuesBoard } from "./ui/GithubBoards";
```

- [ ] **Step 5: 위젯 테스트 작성**

Create `apps/dashboard/src/widgets/monitoring/ui/GithubBoards.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssuesBoard, PullRequestsBoard, WorkflowRunsBoard } from "./GithubBoards";
import { SyncStateBadge } from "./SyncStateBadge";
import { BuildStateCard } from "./BuildStateCard";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubWorkflowRun,
  type GithubSyncState,
} from "@/entities/github-activity/client";

function makeIssue(over: Partial<GithubIssue> = {}): GithubIssue {
  return {
    id: "krdn/a#1", repo: "krdn/a", number: 1, title: "이슈 제목", url: "https://gh/i/1",
    author: "gon", labels: [], createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function makeRun(over: Partial<GithubWorkflowRun> = {}): GithubWorkflowRun {
  return {
    id: "1", repo: "krdn/a", workflowId: "wf", workflowName: "CI", status: "completed",
    conclusion: "success", headSha: "s", headBranch: "main", event: "push",
    runNumber: 1, runAttempt: 1, url: "https://gh/r/1",
    startedAt: new Date(), completedAt: new Date(), ...over,
  };
}

function makePr(over: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    id: "krdn/a#9", repo: "krdn/a", number: 9, title: "PR 제목", url: "https://gh/p/9",
    author: "gon", isDraft: false, headSha: "s",
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

describe("empty state", () => {
  it("이슈 0건이면 안내 문구를 보여준다", () => {
    render(<IssuesBoard issues={[]} staleIds={new Set()} />);
    expect(screen.getByText("열린 이슈가 없습니다.")).toBeTruthy();
  });

  it("run 0건이면 안내 문구를 보여준다", () => {
    render(<WorkflowRunsBoard runs={[]} />);
    expect(screen.getByText("표시할 실행이 없습니다.")).toBeTruthy();
  });
});

describe("정체 강조", () => {
  it("staleIds 에 든 이슈에만 정체 배지가 붙는다", () => {
    render(
      <IssuesBoard
        issues={[makeIssue({ id: "a" }), makeIssue({ id: "b", title: "정상" })]}
        staleIds={new Set(["a"])}
      />,
    );
    expect(screen.getAllByText("정체")).toHaveLength(1);
  });
});

describe("SyncStateBadge", () => {
  it("ok 면 아무것도 렌더하지 않는다 (정상은 조용해야 한다)", () => {
    const { container } = render(<SyncStateBadge state="ok" />);
    expect(container.textContent).toBe("");
  });

  it("error 면 오류 배지를 보여준다", () => {
    render(<SyncStateBadge state="error" detail="429" />);
    expect(screen.getByText("동기화 오류")).toBeTruthy();
  });

  // "데이터 없음"과 "동기화가 죽어 낡음"이 다르게 보여야 한다.
  it("empty 와 stale 은 다른 문구다", () => {
    const { container: a } = render(<SyncStateBadge state="empty" />);
    const { container: b } = render(<SyncStateBadge state="stale" />);
    expect(a.textContent).not.toBe(b.textContent);
  });

  it("토큰 미설정은 비활성 문구", () => {
    render(<SyncStateBadge state="disabled-empty" />);
    expect(screen.getByText("동기화 비활성")).toBeTruthy();
  });
});

describe("BuildStateCard", () => {
  function makeBuild(over: Partial<GithubSyncState> = {}): GithubSyncState {
    return {
      source: "build", lastAttemptAt: new Date(), lastSuccessAt: new Date(),
      lastError: null, totalCount: null, truncated: false,
      buildState: "build-failed", mainHeadSha: "abcdef1234", mainHeadCommittedAt: new Date(),
      buildRunUrl: "https://gh/run/1", buildConclusion: "failure", ...over,
    };
  }

  it("build-failed 를 실패 문구로 보여준다", () => {
    render(<BuildStateCard build={makeBuild()} />);
    expect(screen.getByText("빌드 실패")).toBeTruthy();
  });

  it("HEAD sha 를 7자로 줄여 보여준다", () => {
    render(<BuildStateCard build={makeBuild()} />);
    expect(screen.getByText("abcdef1")).toBeTruthy();
  });

  it("판정 이력이 없으면 안내 문구", () => {
    render(<BuildStateCard build={null} />);
    expect(screen.getByText("아직 판정된 적 없음")).toBeTruthy();
  });
});

describe("PR CI 표시", () => {
  it("failing 을 실패로 표시한다", () => {
    render(
      <PullRequestsBoard
        prs={[makePr()]}
        ciStatus={{ "krdn/a#9": "failing" }}
        staleIds={new Set()}
      />,
    );
    expect(screen.getByText("실패")).toBeTruthy();
  });
});
```

- [ ] **Step 6: 위젯 테스트 통과 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/widgets/monitoring/ui/GithubBoards.test.tsx
```

Expected: PASS — "11 passed" 를 눈으로 확인할 것.

`server-only` 관련 에러가 나면(이 테스트는 jsdom 환경인데 `GithubBoards.tsx` 가
`@/features/github-monitor/lib` → `logger` → `import "server-only"` 를 끌어온다),
`WorkflowRunsBoard` 에서 `normalizeRunOutcome` 대신 로컬 상수 집합으로 실패를
판정하도록 바꾼다:

```ts
const FAILURE_CONCLUSIONS = new Set([
  "failure", "timed_out", "startup_failure", "action_required",
]);
const isFail = (r: GithubWorkflowRun) =>
  r.conclusion != null && FAILURE_CONCLUSIONS.has(r.conclusion);
```

이 경우 Task 15 의 `failingRuns` 도 같은 헬퍼를 쓰도록 맞추고, 두 곳이 갈리지
않게 `widgets/monitoring/lib/runFailure.ts` 로 추출한다.

- [ ] **Step 7: 타입 체크 + lint**

```bash
cd apps/dashboard
pnpm typecheck && pnpm lint
```

Expected: 에러 없음.

- [ ] **Step 8: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/github-monitor/lib/index.ts \
        apps/dashboard/src/widgets/monitoring/ui/SyncStateBadge.tsx \
        apps/dashboard/src/widgets/monitoring/ui/BuildStateCard.tsx \
        apps/dashboard/src/widgets/monitoring/ui/GithubBoards.tsx \
        apps/dashboard/src/widgets/monitoring/ui/GithubBoards.test.tsx \
        apps/dashboard/src/widgets/monitoring/index.ts
git commit -m "feat(monitoring): GitHub 보드 위젯 (#323)

Build 히어로 카드 + Actions·PR·이슈 드릴다운 표. 실패와 정체를
위로 정렬해 판단이 필요한 것부터 보이게 한다. 20행 컷 후
GitHub 원본 링크로 위임."
```

---

## Task 15: /monitoring/github 페이지

**Files:**
- Create: `apps/dashboard/src/app/(dashboard)/monitoring/github/page.tsx`

**Interfaces:**
- Consumes:
  - `@/entities/github-activity/server` — `listOpenIssues`, `listOpenPrs`, `listRecentRuns`, `getSyncStates`, `getBuildState` (Task 5)
  - `@/entities/github-activity/client` — `PrCiStatus`, `SyncSource` 타입 (Task 3)
  - `@/features/github-monitor/lib` — `derivePrCiStatus`, `isPrStale`, `isIssueTriageStale`, `deriveSyncDisplayState`, `normalizeRunOutcome` (Task 14 Step 0 이 배럴 생성)
  - `@/widgets/monitoring` — `AutoRefresh`(기존), `BuildStateCard`, `IssuesBoard`, `PullRequestsBoard`, `SyncStateBadge`, `WorkflowRunsBoard` (Task 14)
- Produces: `/monitoring/github` 라우트

**사전 확인:** `AutoRefresh` 의 prop 이 `intervalMs` 임은 확인됨 (`src/widgets/monitoring/ui/AutoRefresh.tsx`). `PageHeader` 는 `title`·`subtitle`·`actions` 만 받는다 — `description` 은 없다.

- [ ] **Step 1: 페이지 작성**

Create `apps/dashboard/src/app/(dashboard)/monitoring/github/page.tsx`:

```tsx
// /monitoring/github — GitHub 관제 보드 (이슈 #323).
// 갱신: AutoRefresh 15초 폴링. 데이터는 5분 주기 cron 이 적재한 스냅샷이다.
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { env } from "@/shared/config/env";
import {
  listOpenIssues,
  listOpenPrs,
  listRecentRuns,
  getSyncStates,
  getBuildState,
} from "@/entities/github-activity/server";
import { type PrCiStatus, type SyncSource } from "@/entities/github-activity/client";
import {
  derivePrCiStatus,
  isPrStale,
  isIssueTriageStale,
  deriveSyncDisplayState,
  normalizeRunOutcome,
} from "@/features/github-monitor/lib";
import {
  AutoRefresh,
  BuildStateCard,
  IssuesBoard,
  PullRequestsBoard,
  SyncStateBadge,
  WorkflowRunsBoard,
} from "@/widgets/monitoring";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function GithubMonitoringPage() {
  // ⚠️ 인증은 layout 이 아니라 여기서 한다 — layout 인증은 Next 에서
  // 라우트별 보호를 보장하지 않는다.
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [issues, prs, runs, syncStates, build] = await Promise.all([
    listOpenIssues(),
    listOpenPrs(),
    listRecentRuns(),
    getSyncStates(),
    getBuildState(),
  ]);

  const tokenConfigured = env.GITHUB_MONITOR_TOKEN != null && env.GITHUB_MONITOR_TOKEN !== "";
  const stateOf = (source: SyncSource) =>
    deriveSyncDisplayState(syncStates.find((s) => s.source === source) ?? null, {
      tokenConfigured,
    });
  const errorOf = (source: SyncSource) =>
    syncStates.find((s) => s.source === source)?.lastError ?? null;

  const ciStatus: Record<string, PrCiStatus> = {};
  for (const pr of prs) ciStatus[pr.id] = derivePrCiStatus(pr, runs);

  const stalePrIds = new Set(prs.filter((pr) => isPrStale(pr)).map((pr) => pr.id));
  const staleIssueIds = new Set(
    issues.filter((i) => isIssueTriageStale(i)).map((i) => i.id),
  );

  // ⚠️ conclusion === "failure" 만 세면 timed_out·startup_failure·action_required 가
  // 누락된다. 정규화 함수를 단일 기준으로 쓴다.
  const failingRuns = runs.filter((r) => normalizeRunOutcome(r) === "failure").length;
  const failingPrs = Object.values(ciStatus).filter((s) => s === "failing").length;

  // 스냅샷이 잘렸는지 — 보드가 전수인 척하면 안 된다 (스펙 §3).
  const truncationOf = (source: SyncSource) => {
    const s = syncStates.find((x) => x.source === source);
    if (s?.truncated !== true || s.totalCount == null) return null;
    return s.totalCount;
  };

  const org = env.GITHUB_MONITOR_ORG;
  const searchUrl = (kind: "issue" | "pr") =>
    `https://github.com/search?q=${encodeURIComponent(`org:${org} is:${kind} is:open`)}&type=issues`;

  return (
    <PageContainer>
      <PageHeader title="GitHub 관제" subtitle="krdn org 의 이슈·PR·Actions 현황" />
      <AutoRefresh intervalMs={15_000} />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
          <p className="text-xs text-[var(--color-text-muted)]">열린 이슈</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{issues.length}</p>
          {truncationOf("issues") != null && (
            <p className="text-xs text-[var(--color-text-muted)]">
              표시 {issues.length} / 전체 {truncationOf("issues")} ·{" "}
              <a href={searchUrl("issue")} target="_blank" rel="noreferrer" className="underline">
                GitHub 에서 더 보기
              </a>
            </p>
          )}
          <SyncStateBadge state={stateOf("issues")} detail={errorOf("issues")} />
        </div>
        <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
          <p className="text-xs text-[var(--color-text-muted)]">열린 PR (CI 실패)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {prs.length}
            {failingPrs > 0 && <span className="ml-1 text-base text-red-700">({failingPrs})</span>}
          </p>
          {truncationOf("pulls") != null && (
            <p className="text-xs text-[var(--color-text-muted)]">
              표시 {prs.length} / 전체 {truncationOf("pulls")} ·{" "}
              <a href={searchUrl("pr")} target="_blank" rel="noreferrer" className="underline">
                GitHub 에서 더 보기
              </a>
            </p>
          )}
          <SyncStateBadge state={stateOf("pulls")} detail={errorOf("pulls")} />
        </div>
        <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Actions 실패</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{failingRuns}</p>
          <SyncStateBadge state={stateOf("runs")} detail={errorOf("runs")} />
        </div>
        <div>
          <BuildStateCard build={build} />
          <SyncStateBadge state={stateOf("build")} detail={errorOf("build")} />
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <WorkflowRunsBoard runs={runs} />
        <PullRequestsBoard prs={prs} ciStatus={ciStatus} staleIds={stalePrIds} />
        <IssuesBoard issues={issues} staleIds={staleIssueIds} />
      </div>
    </PageContainer>
  );
}
```

- [ ] **Step 2: 타입 체크 + lint**

```bash
cd apps/dashboard
pnpm typecheck && pnpm lint
```

Expected: 에러 없음.

- [ ] **Step 2b: truncated 표시가 스펙 문구와 일치하는지 확인**

```bash
cd apps/dashboard
grep -n "표시 {\|GitHub 에서 더 보기" 'src/app/(dashboard)/monitoring/github/page.tsx'
```

Expected: 이슈·PR 두 KPI 각각에 `표시 N / 전체 M` 과 "GitHub 에서 더 보기" 링크가 있어
총 4줄이 잡힌다. 스펙 §3 이 요구하는 문구와 링크다 — 잘린 스냅샷을 전수인 것처럼
보여주지 않기 위한 것이므로 문구를 임의로 줄이지 말 것.

- [ ] **Step 3: 프로덕션 빌드 (client/server seam 검증)**

```bash
cd apps/dashboard
pnpm build
```

Expected: 성공. `Module not found: Can't resolve 'tls'` 또는 `'net'` 이 나오면 client 컴포넌트가 server barrel 을 import 한 것이다 — 해당 import 를 `@/entities/github-activity/client` 로 고친다.

**이 단계는 건너뛸 수 없다.** typecheck·lint 로는 이 계열 오류를 잡지 못한다.

- [ ] **Step 4: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add 'apps/dashboard/src/app/(dashboard)/monitoring/github/page.tsx'
git commit -m "feat(monitoring): /monitoring/github 페이지 (#323)

KPI 4개 + Build 히어로 + 드릴다운 표 3개. 각 KPI 에 동기화 상태
배지를 붙여 0건과 동기화 실패를 구분한다."
```

---

## Task 16: 알림 링크 분기

**Files:**
- Create: `apps/dashboard/src/features/monitoring-notify/lib/notifyLink.ts`
- Modify: `apps/dashboard/src/features/monitoring-notify/index.ts`
- Test: `apps/dashboard/src/features/monitoring-notify/lib/notifyLink.test.ts`

**Interfaces:**
- Consumes: `EventSource` 에 "github" 추가됨 (Task 11)
- Produces: `linkForSource(source: string): string` — 앱 내부 경로 (`/monitoring` 또는 `/monitoring/github`)

**⚠️ 링크가 두 군데 있다.** `broadcast()` 의 web-push `url` 과 `eventBody()` 의
텔레그램 본문 URL 이 각각 `/monitoring` 을 하드코딩한다. **둘 다** 고쳐야 한다 —
하나만 고치면 채널에 따라 다른 곳으로 가는 비일관이 생긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/dashboard/src/features/monitoring-notify/lib/notifyLink.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { linkForSource } from "./notifyLink";

describe("linkForSource", () => {
  it("github 이벤트는 GitHub 탭으로 보낸다", () => {
    expect(linkForSource("github")).toBe("/monitoring/github");
  });

  it("그 외 소스는 인프라 보드로 보낸다", () => {
    expect(linkForSource("host")).toBe("/monitoring");
    expect(linkForSource("container")).toBe("/monitoring");
    expect(linkForSource("ssl")).toBe("/monitoring");
  });

  it("미지의 소스도 인프라 보드로 폴백한다", () => {
    expect(linkForSource("brand-new-source")).toBe("/monitoring");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/monitoring-notify/lib/notifyLink.test.ts
```

Expected: FAIL — `Failed to resolve import "./notifyLink"`

- [ ] **Step 3: 구현 작성**

Create `apps/dashboard/src/features/monitoring-notify/lib/notifyLink.ts`:

```ts
// 이벤트 소스 → 알림 클릭 시 열릴 앱 내부 경로 (이슈 #323).
// GitHub 이벤트를 /monitoring 으로 보내면 사용자가 탭을 한 번 더 눌러야 한다.
export function linkForSource(source: string): string {
  return source === "github" ? "/monitoring/github" : "/monitoring";
}
```

- [ ] **Step 4: broadcast 에 source 인자 추가**

Modify `apps/dashboard/src/features/monitoring-notify/index.ts`:

**4-1.** import 블록 끝에 추가:

```ts
import { linkForSource } from "./lib/notifyLink";
```

**4-2.** `broadcast` 함수 전체를 교체 (기존 시그니처는 `title, body, tag` 3개):

```ts
async function broadcast(
  title: string,
  body: string,
  tag: string,
  source: string,
): Promise<void> {
  await sendTelegram(`${title}\n${body}`);
  for (const userId of await adminUserIds()) {
    await sendPushToUser(userId, {
      title,
      body,
      // 소스별 분기 — github 이벤트는 GitHub 탭으로 직행한다.
      url: linkForSource(source),
      // dedupKey 기반 태그 — 고정 태그면 SW 가 같은 태그 알림을 교체해
      // 한 sweep 의 다중 장애 중 마지막만 남는다 (Codex P2).
      tag,
    });
  }
}
```

**4-3.** `eventBody` 함수 전체를 교체 (텔레그램 본문의 URL 도 같은 경로로):

```ts
function eventBody(event: MonitoringEventRow): string {
  return [event.detail, `${env.NEXTAUTH_URL}${linkForSource(event.source)}`]
    .filter(Boolean)
    .join("\n");
}
```

**4-4.** `broadcast` 호출부 **두 곳**에 `event.source` 인자 추가.

`notifyOpenCriticals` 안:

```ts
      await broadcast(
        `🔴 [관제] ${event.title}`,
        eventBody(event),
        `monitoring-${event.dedupKey}`,
        event.source,
      );
```

`notifyResolvedCriticals` 안:

```ts
    await broadcast(
      `✅ [관제] 해소: ${event.title}`,
      eventBody(event),
      `monitoring-${event.dedupKey}`,
      event.source,
    );
```

- [ ] **Step 5: 두 호출부가 모두 고쳐졌는지 확인**

```bash
cd apps/dashboard
grep -n "broadcast(" src/features/monitoring-notify/index.ts
```

Expected: 정의 1개 + 호출 2개 = 3줄. 호출 두 곳 모두 뒤에 `event.source,` 인자가 있어야 한다.
하나라도 빠지면 typecheck 가 잡지만, 여기서 눈으로 확인해 두면 다음 단계가 빨라진다.

- [ ] **Step 6: 테스트 통과 + 타입 체크**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm vitest run src/features/monitoring-notify/lib/notifyLink.test.ts && pnpm typecheck
```

Expected: PASS (3개 케이스) + 타입 에러 없음.

- [ ] **Step 7: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/monitoring-notify/lib/notifyLink.ts \
        apps/dashboard/src/features/monitoring-notify/lib/notifyLink.test.ts \
        apps/dashboard/src/features/monitoring-notify/index.ts
git commit -m "fix(monitoring): github 이벤트 알림을 GitHub 탭으로 링크 (#323)

web-push url 과 텔레그램 본문 URL 두 곳 모두 분기한다 — 하나만
고치면 채널에 따라 다른 곳으로 가는 비일관이 생긴다."
```

---

## Task 17: 전체 검증 + 문서 갱신

**Files:**
- Modify: `CLAUDE.md` (도메인 목록의 관제 항목)
- Modify: `docker-compose.yml` (app·cron 서비스 environment)

**Interfaces:**
- Consumes: 전체
- Produces: 배포 가능 상태

- [ ] **Step 1: 전체 테스트 실행**

```bash
cd apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```

Expected: 전부 통과. 실패가 있으면 **중단하고 원인을 보고**할 것 — 통과할 때까지 다음 단계로 가지 않는다.

- [ ] **Step 2: typecheck + lint + build**

```bash
cd apps/dashboard
pnpm typecheck && pnpm lint && pnpm build
```

Expected: 세 명령 모두 성공.

- [ ] **Step 3: compose 에 env 추가**

Modify `docker-compose.yml` — `app` 서비스와 `cron` 서비스의 `environment` 목록 **양쪽 모두**에 추가:

```yaml
      - GITHUB_MONITOR_TOKEN=${GITHUB_MONITOR_TOKEN:-}
      - GITHUB_MONITOR_ORG=${GITHUB_MONITOR_ORG:-krdn}
```

⚠️ compose 의 `environment` 에 나열하지 않으면 `.env` 에 값을 넣어도 컨테이너에 닿지 않는다.
`${VAR:-}` 형태가 필수다 — 빈 기본값이 없으면 미설정 시 compose 가 경고를 낸다.

- [ ] **Step 4: CLAUDE.md 도메인 설명 갱신**

Modify `CLAUDE.md` — "실시간 관제 (Monitoring)" 항목 설명의 마지막 `→ /monitoring` 부분을 다음으로 교체:

```
→ `/monitoring` (인프라 탭) + `/monitoring/github` (GitHub 이슈·PR·Actions, 5분 폴링 — 이슈 #323)
```

- [ ] **Step 5: 환경 변수 표에 추가**

Modify `CLAUDE.md` — 환경 변수 표의 "관제 Phase 2" 행 **뒤**에 추가:

```
| GitHub 관제 | `GITHUB_MONITOR_TOKEN`, `GITHUB_MONITOR_ORG` | 선택 — 미설정 시 GitHub 보드만 비활성 (Fine-grained PAT, read-only) |
```

- [ ] **Step 6: 커밋**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add CLAUDE.md docker-compose.yml
git commit -m "docs: GitHub 관제 문서·compose env 추가 (#323)

compose environment 에 나열하지 않으면 .env 값이 컨테이너에 닿지 않는다."
```

- [ ] **Step 7: PR 생성**

```bash
cd /home/gon/projects/gon/gons-dashboard
git push -u origin HEAD
gh pr create --fill --base main
```

PR 본문에 다음 배포 주의사항을 포함할 것:

```markdown
## 배포 주의

1. **DB 마이그레이션 선적용 필요** — 운영 DB 는 drizzle tracking 을 인식하지 못하므로
   이미지 배포 전에 psql BEGIN/COMMIT 으로 새 마이그레이션을 수동 적용한다.
2. **compose 파일 교체 필요** — 운영 compose 는 git 미동기화다. scp + sudo cp 로
   서버 파일을 먼저 교체하지 않으면 새 env 가 컨테이너에 닿지 않는다.
3. **토큰은 선택** — `GITHUB_MONITOR_TOKEN` 없이도 앱은 정상 부팅하고 보드만
   "동기화 비활성" 으로 표시된다. 토큰 발급 후 `.env` 추가 → app·cron 재기동.
```

---

## Self-Review 결과

**Spec coverage:**

| 스펙 절 | 담당 태스크 |
|---|---|
| §3 rate limit 예산 (7개 호출) | Task 9 (searchIssues/listActiveRepos/listWorkflowRuns/listBuildRuns/getMainHead/getPullHeadSha), Task 11 (호출 조합) |
| §4 데이터 모델 4테이블 | Task 1 |
| §4.1 build 판정 결과 보존 | Task 1 (컬럼), Task 11 (`syncBuild` 저장) |
| §4.2 스냅샷 교체 안전 규칙 5개 | Task 9 (incomplete_results throw), Task 10 (트랜잭션·레포 단위), Task 11 (실패 시 미교체) |
| §4.2 UI 6단계 순서 평가 | Task 7 `deriveSyncDisplayState` |
| §4.3 부분 성공 처리 | Task 11 `syncRuns` |
| §5.0 normalizeRunOutcome | Task 2 |
| §5.1 judgeBuildState | Task 4 |
| §5.2 derivePrCiStatus | Task 6 |
| §5.3 judgeStaleness | Task 7 |
| §6 알림 (synced 만 해소) | Task 11 `syncBuild` |
| §6.1 알림 링크 + EventSource | Task 11 (유니온), Task 16 (링크) |
| §7 FSD 배치 | Task 1·3·5·9·10·11·12·13·14·15 |
| §8 탭 셸 | Task 13 |
| §9 환경 변수 | Task 8, Task 17 (compose) |
| §10 테스트 전략 + 회귀 가드 11개 | Task 2·4·6·7 (순수), Task 10·11 (통합), Task 13 (UI) |

누락 없음.

**회귀 가드 대응표:**

| 스펙 가드 | 구현 위치 |
|---|---|
| 1. `runs:[]` 10분 경계 | Task 4 Step 1 (3개 케이스) |
| 2. 서로 다른 run 모두 attempt 1 | Task 4 Step 1 |
| 3. cancelled ≠ failure | Task 2 Step 1 |
| 4. 다른 sha run 무시 | Task 6 Step 1 |
| 4a. run 0건 → unknown | Task 6 Step 1 |
| 4b. fork 격리 | Task 6 Step 1 |
| 5. API 실패 시 판정·해소 미호출 | Task 11 Step 1 ("build 판정을 건너뛰고…") |
| 6. 동기화 실패 시 행 미삭제 | Task 11 Step 1 ("기존 이슈 행을 삭제하지 않는다") |
| 7. incomplete_results 미교체 | Task 9 Step 1 (클라이언트 throw) + Task 11 Step 1 (스냅샷 보존까지) |
| 8. 레포 부분 실패 격리 | Task 10 Step 1 (DB primitive) + **Task 11 Step 1 (orchestration — lastSuccessAt 보존)** |
| 9. 전체 성공 시 lastError 삭제 | Task 10 Step 1 (`upsertSyncState` 부분 갱신) + Task 11 (`lastError: null` 전달) |
| 10. 첫 부분 성공 → error | Task 7 Step 1 |
| 11. lastError > freshness | Task 7 Step 1 |

**추가 검증** (스펙 §4.2 규칙 5, §6 성공 경로):

| 항목 | 위치 |
|---|---|
| 토큰 미설정 시 lastAttemptAt 갱신 | Task 11 Step 1 |
| build 실패 → critical 이벤트 발행 | Task 11 Step 1 |
| build 성공 → 이벤트 해소 | Task 11 Step 1 |
| building 은 해소하지 않음 | Task 11 Step 1 |
| 위젯 empty/stale/severity (jsdom) | Task 14 Step 5 |
| cron 이 부분 실패를 실패로 기록 | Task 12 Step 1 (`failedSources` throw) |

**Placeholder scan:** TBD·TODO 없음. 모든 코드 스텝에 완전한 코드 포함.

**Type consistency:** `RunOutcome`(Task 2) → Task 4·6 소비, `BuildState`·`PrCiStatus`·`SyncDisplayState`(Task 3) → Task 4·6·7·14·15 소비, `judgeBuildState` 반환 `{state, run}`(Task 4) → Task 11 소비. 함수명 일관 확인 완료.

**실제 코드와 대조 완료** (Codex 리뷰에서 확인된 사실 — 계획이 이미 반영함):

| 항목 | 확인 결과 |
|---|---|
| `PageHeader` | `title`·`subtitle`·`actions` — `description` 없음 (계획은 `subtitle` 사용) |
| `AutoRefresh` | prop 이름 `intervalMs` 맞음 |
| `broadcast()` | 인자 `(title, body, tag)` — `event` 없음. Task 16 이 `source` 인자 추가 |
| `eventBody()` | 텔레그램용 URL 을 따로 조립 — Task 16 이 여기도 분기 |
| vitest 환경 | 기본 `node`. Testing Library 파일에 `// @vitest-environment jsdom` 필수 |
| vitest include | `src/**/*.test.tsx` 포함됨 — 별도 설정 불필요 |
| `recordEvent`/`resolveEvent` | 시그니처 일치 (`{source, severity, title, detail?, dedupKey, hostId?}` / `dedupKey`) |
| drizzle API | `db.transaction`, `$inferInsert`, `onConflictDoUpdate({target, set})` 현행 버전과 일치 |

**남은 확인 지점** (구현 중 실제 시그니처를 봐야 하는 곳 — 계획에 확인 단계 포함):
- Task 12 Step 2: `createCronHandler` 제네릭이 `perTarget` 반환 타입을 받아들이는지
