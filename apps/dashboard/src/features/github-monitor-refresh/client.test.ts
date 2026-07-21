import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth·syncGithub 를 mock — 실제 DB·GitHub 호출 없이 액션 로직만 검증.
const authMock = vi.fn();
const syncGithubMock = vi.fn();

vi.mock("@/shared/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/features/github-monitor", () => ({
  syncGithub: () => syncGithubMock(),
}));

// mock 을 건 뒤 import (동적 import 로 mock 선적용 보장).
async function loadAction() {
  const mod = await import("./client");
  return mod.refreshGithubMonitor;
}

const okSummary = {
  skipped: false,
  lockBusy: false,
  issues: { ok: true, count: 12 },
  pulls: { ok: true, count: 3 },
  runs: { ok: true, repos: 5, failedRepos: [] },
  build: { ok: true, state: "synced" },
};

beforeEach(() => {
  vi.resetModules(); // 모듈 내 in-memory 쿨다운 상태를 매 테스트 초기화
  authMock.mockReset();
  syncGithubMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshGithubMonitor", () => {
  it("미인증이면 Unauthorized 로 거부하고 syncGithub 을 부르지 않는다", async () => {
    authMock.mockResolvedValue(null);
    const refresh = await loadAction();

    const r = await refresh();

    expect(r).toEqual({ ok: false, error: "Unauthorized" });
    expect(syncGithubMock).not.toHaveBeenCalled();
  });

  it("정상 실행 시 summary 를 매핑해 반환한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockResolvedValue(okSummary);
    const refresh = await loadAction();

    const r = await refresh();

    expect(r.ok).toBe(true);
    expect(r.summary).toEqual({
      issues: 12,
      pulls: 3,
      runs: 5,
      skipped: false,
      lockBusy: false,
      failed: [],
    });
  });

  it("부분 실패(일부 소스 ok:false)는 failed 에 소스명을 담는다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    // issues 는 실패(ok:false), runs 는 일부 레포 실패(failedRepos 비어있지 않음).
    syncGithubMock.mockResolvedValue({
      ...okSummary,
      issues: { ok: false, count: 0, error: "rate limited" },
      runs: { ok: true, repos: 4, failedRepos: ["krdn/a"] },
    });
    const refresh = await loadAction();

    const r = await refresh();

    // ok 자체는 true(요청은 수행됨) 지만 failed 로 부분 실패를 노출한다.
    expect(r.ok).toBe(true);
    expect(r.summary?.failed).toEqual(["이슈", "Actions"]);
  });

  it("전부 성공하면 failed 는 빈 배열", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockResolvedValue(okSummary);
    const refresh = await loadAction();

    const r = await refresh();

    expect(r.summary?.failed).toEqual([]);
  });

  it("lockBusy(cron 겹침)를 summary 에 표시한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockResolvedValue({
      ...okSummary,
      skipped: true,
      lockBusy: true,
      issues: { ok: false, count: 0 },
      pulls: { ok: false, count: 0 },
      runs: { ok: false, repos: 0, failedRepos: [] },
    });
    const refresh = await loadAction();

    const r = await refresh();

    expect(r.ok).toBe(true);
    expect(r.summary?.lockBusy).toBe(true);
  });

  it("두 번째 호출은 쿨다운으로 거부한다 (cooldownSec 포함)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockResolvedValue(okSummary);
    const refresh = await loadAction();

    const first = await refresh();
    expect(first.ok).toBe(true);

    vi.setSystemTime(5_000); // 5초 뒤 재호출
    const second = await refresh();

    expect(second.ok).toBe(false);
    expect(second.cooldownSec).toBe(25);
    expect(syncGithubMock).toHaveBeenCalledTimes(1); // 두 번째는 syncGithub 미호출
  });

  it("syncGithub 이 throw 하면 ok:false 로 흡수한다", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    syncGithubMock.mockRejectedValue(new Error("boom"));
    const refresh = await loadAction();

    const r = await refresh();

    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
  });
});
