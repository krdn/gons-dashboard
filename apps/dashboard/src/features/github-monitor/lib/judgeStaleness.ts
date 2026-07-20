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
