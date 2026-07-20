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
