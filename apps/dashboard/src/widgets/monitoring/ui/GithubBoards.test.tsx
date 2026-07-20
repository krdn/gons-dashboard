// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IssuesBoard, PullRequestsBoard, WorkflowRunsBoard } from "./GithubBoards";
import { SyncStateBadge } from "./SyncStateBadge";
import { BuildStateCard } from "./BuildStateCard";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubWorkflowRun,
  type GithubSyncState,
} from "@/entities/github-activity/client";

afterEach(cleanup);

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

describe("WorkflowRunsBoard 실패 판정", () => {
  // conclusion === "failure" 만 보면 timed_out·startup_failure·action_required 가
  // 누락된다. 실패를 위로 올리는 정렬도 normalizeRunOutcome 기준이어야 한다.
  it("timed_out 도 실패로 취급해 success 보다 위에 놓는다", () => {
    render(
      <WorkflowRunsBoard
        runs={[
          makeRun({ id: "ok", workflowName: "정상빌드", conclusion: "success" }),
          makeRun({ id: "to", workflowName: "타임아웃빌드", conclusion: "timed_out" }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1); // 헤더 제외
    expect(rows[0]?.textContent).toContain("타임아웃빌드");
  });

  it("cancelled 는 실패가 아니라 success 뒤에 남는다", () => {
    render(
      <WorkflowRunsBoard
        runs={[
          makeRun({ id: "c", workflowName: "취소빌드", conclusion: "cancelled" }),
          makeRun({ id: "f", workflowName: "실패빌드", conclusion: "failure" }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]?.textContent).toContain("실패빌드");
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
