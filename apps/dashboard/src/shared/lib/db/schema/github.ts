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
