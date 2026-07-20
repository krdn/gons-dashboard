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
