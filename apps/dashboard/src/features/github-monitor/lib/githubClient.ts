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

export async function listActiveRepos(
  token: string,
  org: string,
  nowFn: () => Date = () => new Date(),
): Promise<string[]> {
  const cutoff = nowFn().getTime() - ACTIVE_REPO_WINDOW_MS;
  const active = new Set<string>();

  for (let page = 1; page <= REPO_LIST_MAX_PAGES; page++) {
    const repos = await gh<RawRepo[]>(
      token,
      `/orgs/${org}/repos?sort=pushed&direction=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    let hitCutoff = false;
    for (const r of repos) {
      const pushed = r.pushed_at == null ? 0 : Date.parse(r.pushed_at);
      if (pushed >= cutoff) active.add(r.full_name);
      else hitCutoff = true;
    }
    // pushed 내림차순이므로 cutoff 를 만났거나 페이지가 덜 찼으면 멈춘다.
    if (hitCutoff || repos.length < PER_PAGE) break;
  }

  // 활성 필터와 무관하게 항상 포함 — 배포 파이프라인 판정 대상이다.
  active.add(BUILD_REPO);
  return [...active];
}

export async function listWorkflowRuns(token: string, repo: string): Promise<RawRun[]> {
  const res = await gh<{ workflow_runs: RawRun[] }>(
    token,
    `/repos/${repo}/actions/runs?per_page=${RUNS_PER_REPO}`,
  );
  return res.workflow_runs;
}

export async function listBuildRuns(
  token: string,
  repo: string,
  workflowPath: string,
): Promise<RawRun[]> {
  const wf = encodeURIComponent(workflowPath);
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
