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
