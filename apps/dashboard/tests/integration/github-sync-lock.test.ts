// syncGithub 의 advisory lock 동작 — 별도 파일인 이유:
//
// 이 테스트는 첫 실행을 fetch 단계에서 붙잡아둔 채 두 번째를 호출한다.
// 같은 파일의 다른 테스트들과 섞이면 vi.resetModules() 로 매번 새로 로드되는
// 모듈이 globalThis 캐시의 같은 커넥션 풀(max 10)에서 reserve() 를 반복해,
// 반납 지연이 쌓이면 뒤 테스트가 연결을 못 얻고 timeout 된다.
// vitest 는 fileParallelism: false 라 파일 단위로는 직렬 실행되고 각 파일이
// 깨끗한 모듈 그래프에서 시작하므로, 분리하면 간섭이 사라진다.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/shared/lib/db/client";
import { githubIssues, githubSyncState, githubWorkflowRuns } from "@/shared/lib/db/schema";

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

const EMPTY_SEARCH = { total_count: 0, incomplete_results: false, items: [] };

/** 전 소스가 성공하는 최소 라우트 집합. */
function okRoutes(): { match: RegExp; status?: number; body: unknown }[] {
  return [
    { match: /api\.github\.com\/users\/krdn$/, body: { type: "Organization" } },
    { match: /api\.github\.com\/user$/, body: { login: "krdn" } },
    { match: /search\/issues/, body: EMPTY_SEARCH },
    { match: /orgs\/krdn\/repos/, body: [] },
    {
      match: /commits\/main/,
      body: { sha: "s", commit: { committer: { date: new Date().toISOString() } } },
    },
    { match: /actions\/workflows/, body: { workflow_runs: [] } },
    { match: /actions\/runs/, body: { workflow_runs: [] } },
  ];
}

function mockRoutes(routes: { match: RegExp; status?: number; body: unknown }[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const route = routes.find((r) => r.match.test(url));
    if (route == null) {
      return new Response(JSON.stringify({ message: "unmatched" }), { status: 404 });
    }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  });
}

beforeEach(async () => {
  await db.delete(githubIssues);
  await db.delete(githubWorkflowRuns);
  await db.delete(githubSyncState);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/shared/config/env");
  vi.resetModules();
});

describe("syncGithub — 동시 실행 방지", () => {
  // cron 의 HTTP timeout(120s)은 요청만 끊고 서버 측 실행은 계속되므로,
  // GitHub 응답이 느리면 다음 주기(5분)와 겹친다. 두 실행이 DELETE+INSERT 와
  // prune 을 교차하면 오래된 실행이 최신 스냅샷을 덮거나 지운다.
  it("이미 실행 중이면 두 번째 호출은 대기 없이 lockBusy 로 반환한다", async () => {
    const pending: ((r: Response) => void)[] = [];
    let signalStarted: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });

    // 첫 호출이 GitHub 에 닿으면 신호를 주고, 풀어줄 때까지 모든 fetch 를 멈춘다.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      signalStarted();
      return new Promise<Response>((res) => pending.push(res));
    });

    const syncGithub = await loadSync("tok");
    const first = syncGithub();
    await firstStarted;

    const second = await syncGithub();
    expect(second.lockBusy).toBe(true);
    expect(second.skipped).toBe(true);

    // 멈춰둔 fetch 를 전부 풀어 첫 실행을 정리한다 (락 해제까지 확인).
    for (const res of pending) {
      res(new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
    }
    await first;
  });

  it("락이 해제된 뒤에는 정상 실행된다", async () => {
    mockRoutes(okRoutes());
    const syncGithub = await loadSync("tok");

    const a = await syncGithub();
    const b = await syncGithub();

    expect(a.lockBusy).toBeUndefined();
    expect(b.lockBusy).toBeUndefined();
    expect(b.issues.ok).toBe(true);
  });
});
