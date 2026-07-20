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
