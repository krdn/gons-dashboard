import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/shared/lib/db/client";
import {
  githubIssues,
  githubWorkflowRuns,
  githubSyncState,
  monitoringEvents,
} from "@/shared/lib/db/schema";

const BUILD_DEDUP = "github:krdn/gons-dashboard:build-failed";

/**
 * env 는 모듈 로드 시점에 평가되므로 동적 import 로 갈아끼운다.
 *
 * ⚠️ importActual 로 실제 env 를 펼친 뒤 두 필드만 덮는다 — 객체를 통째로
 * 교체하면 syncGithub 가 (지금은 아니어도 나중에) 다른 env 를 읽을 때
 * undefined 를 만나 테스트가 진짜 원인과 무관하게 깨진다.
 */
async function loadSync(token: string | undefined) {
  vi.resetModules();
  vi.doMock("@/shared/config/env", async () => {
    const actual = await vi.importActual<typeof import("@/shared/config/env")>(
      "@/shared/config/env",
    );
    return {
      ...actual,
      env: { ...actual.env, GITHUB_MONITOR_TOKEN: token, GITHUB_MONITOR_ORG: "krdn" },
    };
  });
  return (await import("@/features/github-monitor")).syncGithub;
}

/** GitHub API 응답을 경로 패턴별로 지정하는 fetch mock. */
function mockFetchByPath(routes: { match: RegExp; status?: number; body: unknown }[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const route = routes.find((r) => r.match.test(url));
    if (route == null) {
      return new Response(JSON.stringify({ message: "unmatched" }), { status: 404 });
    }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  });
}

const EMPTY_SEARCH = { total_count: 0, incomplete_results: false, items: [] };

async function seedIssue() {
  await db.insert(githubIssues).values({
    id: "krdn/a#1", repo: "krdn/a", number: 1, title: "t", url: "u",
    author: null, labels: [], createdAt: new Date(), updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(githubIssues);
  await db.delete(githubWorkflowRuns);
  await db.delete(githubSyncState);
  await db.delete(monitoringEvents);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/shared/config/env");
  vi.resetModules();
});

describe("syncGithub — 토큰 미설정", () => {
  it("skip 하고 기존 행을 지우지 않는다", async () => {
    await seedIssue();
    const syncGithub = await loadSync(undefined);
    const summary = await syncGithub();

    expect(summary.skipped).toBe(true);
    expect(await db.select().from(githubIssues)).toHaveLength(1);
  });

  // §4.2 규칙 5 — "시도는 하고 있다"를 남겨야 보드가 비활성과
  // 완전 정지를 구분할 수 있다.
  it("네 소스의 lastAttemptAt 을 갱신한다", async () => {
    const syncGithub = await loadSync(undefined);
    await syncGithub();

    const rows = await db.select().from(githubSyncState);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.lastAttemptAt != null)).toBe(true);
    expect(rows.every((r) => r.lastSuccessAt == null)).toBe(true);
  });
});

describe("syncGithub — API 실패", () => {
  it("기존 이슈 행을 삭제하지 않는다", async () => {
    await seedIssue();
    mockFetchByPath([{ match: /./, status: 429, body: { message: "rate limited" } }]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.issues.ok).toBe(false);
    expect(await db.select().from(githubIssues)).toHaveLength(1);
  });

  // 회귀 가드 5: API 실패에서 판정·해소가 일어나면
  // Build 가 계속 실패 중인데 "복구됨" 알림이 나간다.
  it("build 판정을 건너뛰고 기존 open 이벤트를 유지한다", async () => {
    await db.insert(monitoringEvents).values({
      source: "github",
      severity: "critical",
      title: "Build 실패",
      dedupKey: BUILD_DEDUP,
    });
    mockFetchByPath([{ match: /./, status: 500, body: { message: "boom" } }]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.ok).toBe(false);
    expect(summary.build.state).toBeNull();

    const events = await db.select().from(monitoringEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.resolvedAt).toBeNull(); // 해소되지 않았다
  });

  // 회귀 가드 7: 부분 결과로 교체하면 멀쩡한 항목이 사라진다.
  it("incomplete_results 면 이슈 스냅샷을 교체하지 않는다", async () => {
    await seedIssue();
    mockFetchByPath([
      {
        // ⚠️ encodeURIComponent 가 "is:issue" 를 "is%3Aissue" 로 바꾼다.
        // 원문으로 매칭하면 폴백 라우트에 걸려 정상 응답이 돌아오고,
        // 이 테스트가 아무것도 검증하지 못한 채 통과한다.
        match: /search\/issues.*is%3Aissue/,
        body: { total_count: 1, incomplete_results: true, items: [{ id: 99 }] },
      },
      { match: /./, body: EMPTY_SEARCH },
    ]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.issues.ok).toBe(false);
    const rows = await db.select().from(githubIssues);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("krdn/a#1"); // 기존 행 그대로
  });
});

describe("syncGithub — 성공 경로", () => {
  const HEAD_SHA = "aaaaaaaabbbbbbbb";

  function buildRoutes(conclusion: string) {
    return [
      { match: /search\/issues/, body: EMPTY_SEARCH },
      { match: /orgs\/krdn\/repos/, body: [] },
      {
        match: /commits\/main/,
        body: {
          sha: HEAD_SHA,
          // 유예(10분)를 넘긴 과거 커밋 — no-run 판정이 살아있게 한다
          commit: { committer: { date: new Date(Date.now() - 3_600_000).toISOString() } },
        },
      },
      {
        match: /actions\/workflows/,
        body: {
          workflow_runs: [
            {
              id: 1, name: "CI", workflow_id: 1, path: ".github/workflows/ci.yml",
              status: "completed", conclusion, head_sha: HEAD_SHA, head_branch: "main",
              event: "push", run_number: 1, run_attempt: 1,
              html_url: "https://gh/run/1",
              run_started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
      },
      { match: /actions\/runs/, body: { workflow_runs: [] } },
    ];
  }

  it("build 실패 시 critical 이벤트를 발행한다", async () => {
    mockFetchByPath(buildRoutes("failure"));
    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.state).toBe("build-failed");
    const events = await db.select().from(monitoringEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.severity).toBe("critical");
    expect(events[0]?.dedupKey).toBe(BUILD_DEDUP);
  });

  it("build 성공 시 기존 open 이벤트를 해소한다", async () => {
    await db.insert(monitoringEvents).values({
      source: "github", severity: "critical", title: "Build 실패", dedupKey: BUILD_DEDUP,
    });
    mockFetchByPath(buildRoutes("success"));

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.state).toBe("synced");
    const events = await db.select().from(monitoringEvents);
    expect(events[0]?.resolvedAt).not.toBeNull();
  });

  // building·no-run·unknown 은 no-op — 확인되지 않은 상태에서
  // 해소하면 거짓 안심을 준다.
  it("build 진행 중이면 기존 이벤트를 해소하지 않는다", async () => {
    await db.insert(monitoringEvents).values({
      source: "github", severity: "critical", title: "Build 실패", dedupKey: BUILD_DEDUP,
    });
    // ⚠️ buildRoutes 를 filter 로 걸러내면 안 된다. 정규식의 .source 는
    // 이스케이프를 보존한 "actions\\/workflows" 라, /actions\/workflows/.test()
    // 가 항상 false 를 반환해 원본 success 라우트가 살아남는다.
    // mockFetchByPath 는 첫 매치를 쓰므로 진행 중 run 이 무시되고 synced 가 된다.
    // 라우트를 명시적으로 구성한다.
    mockFetchByPath([
      {
        match: /actions\/workflows/,
        body: {
          workflow_runs: [
            {
              id: 2, name: "CI", workflow_id: 1, path: ".github/workflows/ci.yml",
              status: "in_progress", conclusion: null, head_sha: HEAD_SHA,
              head_branch: "main", event: "push", run_number: 2, run_attempt: 1,
              html_url: "https://gh/run/2",
              run_started_at: new Date().toISOString(), updated_at: null,
            },
          ],
        },
      },
      { match: /search\/issues/, body: EMPTY_SEARCH },
      { match: /orgs\/krdn\/repos/, body: [] },
      {
        match: /commits\/main/,
        body: {
          sha: HEAD_SHA,
          commit: { committer: { date: new Date(Date.now() - 3_600_000).toISOString() } },
        },
      },
      { match: /actions\/runs/, body: { workflow_runs: [] } },
    ]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.build.state).toBe("building");
    const events = await db.select().from(monitoringEvents);
    expect(events[0]?.resolvedAt).toBeNull();
  });
});

describe("syncGithub — Actions 부분 실패", () => {
  // 회귀 가드 8: 성공한 레포는 갱신되지만 lastSuccessAt 은 갱신되지 않는다(§4.3).
  it("실패 레포의 run 은 유지하고 lastSuccessAt 을 갱신하지 않는다", async () => {
    await db.insert(githubWorkflowRuns).values({
      id: "old-b", repo: "krdn/b", workflowId: "wf", workflowName: "CI",
      status: "completed", conclusion: "success", headSha: "s", headBranch: "main",
      event: "push", runNumber: 1, runAttempt: 1, url: "u",
      startedAt: new Date(), completedAt: new Date(),
    });

    mockFetchByPath([
      { match: /search\/issues/, body: EMPTY_SEARCH },
      { match: /commits\/main/, body: { sha: "x", commit: { committer: { date: new Date().toISOString() } } } },
      { match: /actions\/workflows/, body: { workflow_runs: [] } },
      {
        match: /orgs\/krdn\/repos/,
        body: [
          { full_name: "krdn/a", pushed_at: new Date().toISOString() },
          { full_name: "krdn/b", pushed_at: new Date().toISOString() },
        ],
      },
      // krdn/b 만 실패시킨다
      { match: /repos\/krdn\/b\/actions\/runs/, status: 500, body: { message: "boom" } },
      {
        match: /repos\/krdn\/a\/actions\/runs/,
        body: {
          workflow_runs: [
            {
              id: 10, name: "CI", workflow_id: 1, path: "p", status: "completed",
              conclusion: "success", head_sha: "s", head_branch: "main", event: "push",
              run_number: 1, run_attempt: 1, html_url: "u",
              run_started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            },
          ],
        },
      },
    ]);

    const syncGithub = await loadSync("tok");
    const summary = await syncGithub();

    expect(summary.runs.ok).toBe(false);
    expect(summary.runs.failedRepos).toContain("krdn/b");

    // 실패한 레포의 이전 run 은 살아있다
    const runs = await db.select().from(githubWorkflowRuns);
    expect(runs.some((r) => r.id === "old-b")).toBe(true);
    // 성공한 레포는 갱신됐다
    expect(runs.some((r) => r.id === "10")).toBe(true);

    const runsState = (await db.select().from(githubSyncState)).find((s) => s.source === "runs");
    expect(runsState?.lastSuccessAt).toBeNull();
    expect(runsState?.lastError).toContain("krdn/b");
  });
});
