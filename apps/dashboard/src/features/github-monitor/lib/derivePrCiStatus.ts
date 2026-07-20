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
