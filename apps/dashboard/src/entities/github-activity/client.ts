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
