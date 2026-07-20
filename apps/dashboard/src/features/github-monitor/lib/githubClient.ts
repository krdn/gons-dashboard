// GitHub REST API 클라이언트 — 이슈 #323.
//
// 에러를 GithubApiError 로 정규화해 호출자가 "실패했으니 스냅샷을 교체하지
// 않는다"를 단일 조건으로 판단할 수 있게 한다.
//
// ⚠️ incomplete_results 를 성공으로 취급하지 않는다. GitHub 이 쿼리를
// 타임아웃시킨 부분 결과로 스냅샷을 교체하면 멀쩡한 항목이 사라진다.
import "server-only";
import {
  SEARCH_MAX_PAGES,
  REPO_LIST_MAX_PAGES,
  ACTIVE_REPO_WINDOW_MS,
  RUNS_PER_REPO,
  BUILD_REPO,
} from "../config/thresholds";

const API = "https://api.github.com";
const PER_PAGE = 100;

export class GithubApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
  }
}

export interface RawSearchItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  labels: { name: string }[];
  draft?: boolean;
  repository_url: string;
  created_at: string;
  updated_at: string;
}

export interface RawRun {
  id: number;
  name: string | null;
  workflow_id: number;
  path?: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_branch: string | null;
  event: string | null;
  run_number: number;
  run_attempt: number;
  html_url: string;
  run_started_at: string | null;
  updated_at: string | null;
}

async function gh<T>(token: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // Next 의 fetch 캐시가 끼면 폴링이 옛 결과를 되돌려준다.
      cache: "no-store",
    });
  } catch (err) {
    throw new GithubApiError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) {
    throw new GithubApiError(`GitHub ${path} → ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: RawSearchItem[];
}

export async function searchIssues(
  token: string,
  org: string,
  kind: "issue" | "pr",
): Promise<{ items: RawSearchItem[]; totalCount: number; truncated: boolean }> {
  const q = encodeURIComponent(`org:${org} is:${kind} is:open`);
  const items: RawSearchItem[] = [];
  let totalCount = 0;
  let truncated = false;

  for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
    const res = await gh<SearchResponse>(
      token,
      `/search/issues?q=${q}&sort=updated&order=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    if (res.incomplete_results) {
      throw new GithubApiError("search returned incomplete_results", 0);
    }
    totalCount = res.total_count;
    items.push(...res.items);
    // 페이지가 꽉 차지 않았으면 마지막 페이지다.
    if (res.items.length < PER_PAGE) break;
    if (page === SEARCH_MAX_PAGES && totalCount > items.length) truncated = true;
  }

  return { items, totalCount, truncated };
}

interface RawRepo {
  full_name: string;
  pushed_at: string | null;
}

export interface ActiveRepos {
  repos: string[];
  /**
   * 목록을 끝까지 훑었는지. false = 페이지 상한에서 잘렸다는 뜻이므로
   * 호출자는 이 목록을 "전체"로 간주하는 작업(prune 등)을 해선 안 된다.
   */
  complete: boolean;
}

/**
 * 소유자에 맞는 레포 목록 경로를 정한다.
 *
 * ⚠️ `GITHUB_MONITOR_ORG` 가 organization 이 아니라 **개인 계정**일 수 있다.
 * 실제 `krdn` 이 그렇다(User, 레포 181개 중 private 21개) — `/orgs/krdn/repos` 는
 * 영구히 404 라 분기가 없으면 Actions 수집이 통째로 죽는다. Search API 의
 * `org:` 한정자는 User 에도 동작해 이슈·PR 만 정상인 부분 실패가 된다.
 *
 * ⚠️ 404 로 타입을 추정하지 않고 `/users/{owner}` 의 `type` 을 명시 조회한다.
 * 404 는 다른 이유로도 날 수 있고, 무엇보다 **폴백 대상 선택이 prune 안전성과
 * 직결**되기 때문이다:
 *   - `/users/{owner}/repos` 는 **public 만** 반환한다. 이 목록으로 전역
 *     NOT IN prune 을 돌리면 private 레포의 run 이 매 주기 삭제된다.
 *   - 토큰 소유자 본인이면 `/user/repos?affiliation=owner&visibility=all` 이
 *     private 까지 포함하므로 이쪽을 쓴다.
 *   - 제3자 User 면 private 을 볼 수 없다 → `canPrune: false` 로 알려
 *     호출자가 전역 삭제를 하지 않게 한다.
 */
interface RepoSource {
  path: (page: number) => string;
  /** 이 경로가 소유자의 **전체** 레포를 보여주는가. false 면 prune 금지. */
  canPrune: boolean;
}

async function resolveRepoSource(token: string, owner: string): Promise<RepoSource> {
  const query = (page: number) =>
    `?sort=pushed&direction=desc&per_page=${PER_PAGE}&page=${page}`;

  const account = await gh<{ type: string }>(token, `/users/${owner}`);
  if (account.type === "Organization") {
    return { path: (p) => `/orgs/${owner}/repos${query(p)}`, canPrune: true };
  }

  // User 계정 — 토큰 소유자 본인이면 private 까지 보인다.
  const me = await gh<{ login: string }>(token, "/user");
  if (me.login.toLowerCase() === owner.toLowerCase()) {
    return {
      path: (p) =>
        `/user/repos?affiliation=owner&visibility=all&sort=pushed&direction=desc&per_page=${PER_PAGE}&page=${p}`,
      canPrune: true,
    };
  }

  // 제3자 User — public 만 보이므로 목록이 전체가 아니다.
  return { path: (p) => `/users/${owner}/repos${query(p)}`, canPrune: false };
}

export async function listActiveRepos(
  token: string,
  org: string,
  nowFn: () => Date = () => new Date(),
): Promise<ActiveRepos> {
  const cutoff = nowFn().getTime() - ACTIVE_REPO_WINDOW_MS;
  const active = new Set<string>();
  const source = await resolveRepoSource(token, org);
  // 목록을 끝까지 훑었는가. false 면 pruneRunsNotIn 을 건너뛴다 —
  // 잘린 목록으로 NOT IN 삭제하면 상한 밖 레포의 정상 run 이 매 주기 지워진다.
  let pagedToEnd = false;

  for (let page = 1; page <= REPO_LIST_MAX_PAGES; page++) {
    const repos = await gh<RawRepo[]>(token, source.path(page));
    let hitCutoff = false;
    for (const r of repos) {
      const pushed = r.pushed_at == null ? 0 : Date.parse(r.pushed_at);
      if (pushed >= cutoff) active.add(r.full_name);
      else hitCutoff = true;
    }
    // pushed 내림차순이므로 cutoff 를 만났거나 페이지가 덜 찼으면 전부 본 것이다.
    if (hitCutoff || repos.length < PER_PAGE) {
      pagedToEnd = true;
      break;
    }
  }

  // 활성 필터와 무관하게 항상 포함 — 배포 파이프라인 판정 대상이다.
  active.add(BUILD_REPO);
  // 페이지를 끝까지 봤더라도 소스가 부분 목록(제3자 User = public only)이면
  // 전체로 간주할 수 없다. 두 조건을 모두 만족할 때만 prune 을 허용한다.
  return { repos: [...active], complete: pagedToEnd && source.canPrune };
}

export async function listWorkflowRuns(token: string, repo: string): Promise<RawRun[]> {
  const res = await gh<{ workflow_runs: RawRun[] }>(
    token,
    `/repos/${repo}/actions/runs?per_page=${RUNS_PER_REPO}`,
  );
  return res.workflow_runs;
}

/**
 * 지정 워크플로의 main 브랜치 run 조회.
 *
 * @param workflowFile 워크플로 **파일명** (`"ci.yml"`). 전체 경로가 아니다 —
 *   GitHub REST 의 `workflow_id` 파라미터는 숫자 ID 또는 파일명을 받는다.
 *   경로를 넣어도 현재는 통하지만 문서화되지 않은 동작이라 의존하지 않는다.
 */
export async function listBuildRuns(
  token: string,
  repo: string,
  workflowFile: string,
): Promise<RawRun[]> {
  const wf = encodeURIComponent(workflowFile);
  const res = await gh<{ workflow_runs: RawRun[] }>(
    token,
    `/repos/${repo}/actions/workflows/${wf}/runs?branch=main&per_page=5`,
  );
  return res.workflow_runs;
}

export async function getMainHead(
  token: string,
  repo: string,
): Promise<{ sha: string; committedAt: Date }> {
  const res = await gh<{
    sha: string;
    commit: { committer: { date: string } | null };
  }>(token, `/repos/${repo}/commits/main`);
  const date = res.commit.committer?.date;
  return {
    sha: res.sha,
    committedAt: date == null ? new Date(0) : new Date(date),
  };
}

export async function getPullHeadSha(
  token: string,
  repo: string,
  number: number,
): Promise<string> {
  const res = await gh<{ head: { sha: string } }>(token, `/repos/${repo}/pulls/${number}`);
  return res.head.sha;
}
