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
