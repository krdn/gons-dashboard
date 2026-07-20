import { describe, it, expect, vi, afterEach } from "vitest";
import {
  searchIssues,
  listActiveRepos,
  listBuildRuns,
  GithubApiError,
} from "./githubClient";

const TOKEN = "test-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchIssues", () => {
  it("단일 페이지 결과를 반환한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ total_count: 2, incomplete_results: false, items: [{ id: 1 }, { id: 2 }] }),
    );
    const r = await searchIssues(TOKEN, "krdn", "issue");
    expect(r.items).toHaveLength(2);
    expect(r.totalCount).toBe(2);
    expect(r.truncated).toBe(false);
  });

  // incomplete_results 는 GitHub 이 쿼리를 타임아웃시킨 부분 결과다.
  // 이걸로 스냅샷을 교체하면 멀쩡한 항목이 사라진다.
  it("incomplete_results 면 throw 한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ total_count: 1, incomplete_results: true, items: [{ id: 1 }] }),
    );
    await expect(searchIssues(TOKEN, "krdn", "issue")).rejects.toThrow(GithubApiError);
  });

  // 401=토큰 무효, 403=권한 부족/2차 rate limit, 429=rate limit.
  // 셋 다 "스냅샷을 교체하면 안 되는 실패"라 같은 경로로 흘러야 한다.
  it.each([401, 403, 429])("%i 이면 GithubApiError 로 status 를 실어 던진다", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "Bad" }, status));
    await expect(searchIssues(TOKEN, "krdn", "issue")).rejects.toMatchObject({ status });
  });

  it("네트워크 오류도 GithubApiError 로 감싼다 (status 0)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(searchIssues(TOKEN, "krdn", "issue")).rejects.toMatchObject({ status: 0 });
  });

  it("2페이지 상한에서 자르고 truncated 를 표시한다", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    // Response 본문은 1회만 읽을 수 있어 mockResolvedValue 로 같은 객체를 재사용하면
    // 2번째 페이지에서 "Body already read" 가 난다. 호출마다 새 Response 를 만든다.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ total_count: 500, incomplete_results: false, items: full })),
    );
    const r = await searchIssues(TOKEN, "krdn", "issue");
    expect(r.items).toHaveLength(200); // 100 × 2페이지
    expect(r.truncated).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("결과가 페이지 크기 미만이면 다음 페이지를 요청하지 않는다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ total_count: 3, incomplete_results: false, items: [{ id: 1 }] }),
    );
    await searchIssues(TOKEN, "krdn", "issue");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("listActiveRepos", () => {
  const NOW = new Date("2026-07-20T12:00:00Z");
  const nowFn = () => NOW;
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60_000).toISOString();

  it("7일 이내 push 된 레포만 돌려준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        { full_name: "krdn/a", pushed_at: daysAgo(1) },
        { full_name: "krdn/b", pushed_at: daysAgo(30) },
      ]),
    );
    const { repos } = await listActiveRepos(TOKEN, "krdn", nowFn);
    expect(repos).toContain("krdn/a");
    expect(repos).not.toContain("krdn/b");
  });

  // ⚠️ GITHUB_MONITOR_ORG 가 organization 이 아닐 수 있다. 실제 krdn 은
  // User 계정(레포 181개)이라 /orgs/krdn/repos 는 영구히 404 다 —
  // 폴백이 없으면 Actions 수집이 통째로 죽는다.
  it("org 가 404 면 users 엔드포인트로 폴백한다", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/orgs/")) {
        return Promise.resolve(jsonResponse({ message: "Not Found" }, 404));
      }
      return Promise.resolve(
        jsonResponse([{ full_name: "krdn/a", pushed_at: daysAgo(1) }]),
      );
    });

    const { repos } = await listActiveRepos(TOKEN, "krdn", nowFn);

    expect(repos).toContain("krdn/a");
    expect(spy.mock.calls.some((c) => String(c[0]).includes("/users/krdn/repos"))).toBe(true);
  });

  it("org 가 404 가 아닌 에러면 폴백하지 않고 전파한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "rate limited" }, 429),
    );
    await expect(listActiveRepos(TOKEN, "krdn", nowFn)).rejects.toMatchObject({ status: 429 });
  });

  // complete=false 로 prune 을 건너뛰게 하는 신호. 이게 없으면 잘린 목록으로
  // NOT IN 삭제가 일어나 상한 밖 레포의 정상 run 이 매 주기 지워진다.
  it("cutoff 를 만나면 complete=true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        { full_name: "krdn/a", pushed_at: daysAgo(1) },
        { full_name: "krdn/old", pushed_at: daysAgo(30) },
      ]),
    );
    const r = await listActiveRepos(TOKEN, "krdn", nowFn);
    expect(r.complete).toBe(true);
  });

  it("페이지 상한까지 전부 활성이면 complete=false", async () => {
    // 2페이지 모두 100건 가득 + 전부 활성 → cutoff 를 못 만나고 상한에서 끊긴다
    const full = Array.from({ length: 100 }, (_, i) => ({
      full_name: `krdn/r${i}`,
      pushed_at: daysAgo(1),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse(full)),
    );
    const r = await listActiveRepos(TOKEN, "krdn", nowFn);
    expect(r.complete).toBe(false);
  });

  // 배포 파이프라인 판정 대상이라 push 가 없어도 항상 포함해야 한다.
  it("gons-dashboard 는 오래돼도 항상 포함한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([{ full_name: "krdn/gons-dashboard", pushed_at: daysAgo(365) }]),
    );
    const { repos } = await listActiveRepos(TOKEN, "krdn", nowFn);
    expect(repos).toContain("krdn/gons-dashboard");
  });
});

describe("listBuildRuns", () => {
  // ⚠️ GitHub REST 의 workflow_id 파라미터는 숫자 ID 또는 **파일명**을 받는다.
  // 전체 경로(.github/workflows/ci.yml)를 인코딩해 넣어도 현재는 200 이 오지만
  // 문서화되지 않은 관용 동작이라, 깨지면 build-failed 감지가 조용히 죽는다.
  // 이 테스트가 URL 형식을 고정한다.
  it("파일명·branch=main 으로 정확한 경로를 호출한다", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ workflow_runs: [] }));

    await listBuildRuns(TOKEN, "krdn/gons-dashboard", "ci.yml");

    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toBe(
      "https://api.github.com/repos/krdn/gons-dashboard/actions/workflows/ci.yml/runs?branch=main&per_page=5",
    );
    // 경로 구분자가 인코딩돼 들어가면 문서화된 형식을 벗어난 것이다.
    expect(url).not.toContain("%2F");
  });

  it("workflow_runs 배열을 그대로 돌려준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ workflow_runs: [{ id: 1 }, { id: 2 }] }),
    );
    const runs = await listBuildRuns(TOKEN, "krdn/gons-dashboard", "ci.yml");
    expect(runs).toHaveLength(2);
  });

  it("404 면 GithubApiError 로 던진다 (워크플로 식별자 오류 감지)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "Not Found" }, 404),
    );
    await expect(
      listBuildRuns(TOKEN, "krdn/gons-dashboard", "nope.yml"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
