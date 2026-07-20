// GitHub 동기화 오케스트레이션 — server entrypoint (이슈 #323).
//
// 소스별로 독립 수행한다. 한 소스가 실패해도 다른 소스는 각자 교체된다(§4.2).
// 실패한 소스는 스냅샷을 건드리지 않고 lastError 만 기록한다.
import "server-only";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";
import { recordEvent, resolveEvent } from "@/entities/monitoring/server";
import {
  replaceIssues,
  replacePrs,
  replaceRunsForRepo,
  pruneRunsNotIn,
  upsertSyncState,
} from "@/entities/github-activity/server";
import { type BuildState } from "@/entities/github-activity/client";
import {
  searchIssues,
  listActiveRepos,
  listWorkflowRuns,
  listBuildRuns,
  getMainHead,
  getPullHeadSha,
  type RawSearchItem,
  type RawRun,
} from "./lib/githubClient";
import { judgeBuildState } from "./lib/judgeBuildState";
import { BUILD_REPO, BUILD_WORKFLOW_FILE, PR_HEAD_FETCH_LIMIT } from "./config/thresholds";

export interface SyncSummary {
  skipped: boolean;
  issues: { ok: boolean; count: number; error?: string };
  pulls: { ok: boolean; count: number; error?: string };
  runs: { ok: boolean; repos: number; failedRepos: string[] };
  build: { ok: boolean; state: BuildState | null; error?: string };
}

const BUILD_DEDUP_KEY = `github:${BUILD_REPO}:build-failed`;

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/** repository_url("https://api.github.com/repos/krdn/a") → "krdn/a" */
function repoFromUrl(url: string): string {
  return url.split("/repos/")[1] ?? "unknown";
}

function toRunRow(repo: string, r: RawRun) {
  return {
    id: String(r.id),
    repo,
    // path 가 없으면 workflow_id 로 폴백 — 둘 다 이름보다 안정적이다.
    workflowId: r.path ?? String(r.workflow_id),
    workflowName: r.name ?? "(이름 없음)",
    status: r.status,
    conclusion: r.conclusion,
    headSha: r.head_sha,
    headBranch: r.head_branch,
    event: r.event,
    runNumber: r.run_number,
    runAttempt: r.run_attempt,
    url: r.html_url,
    startedAt: r.run_started_at == null ? null : new Date(r.run_started_at),
    completedAt: r.updated_at == null ? null : new Date(r.updated_at),
  };
}

function toIssueRow(item: RawSearchItem) {
  const repo = repoFromUrl(item.repository_url);
  return {
    id: `${repo}#${item.number}`,
    repo,
    number: item.number,
    title: item.title,
    url: item.html_url,
    author: item.user?.login ?? null,
    labels: item.labels.map((l) => l.name),
    createdAt: new Date(item.created_at),
    updatedAt: new Date(item.updated_at),
  };
}

async function syncIssues(token: string, org: string): Promise<SyncSummary["issues"]> {
  const now = new Date();
  await upsertSyncState("issues", { lastAttemptAt: now });
  try {
    const { items, totalCount, truncated } = await searchIssues(token, org, "issue");
    await replaceIssues(items.map(toIssueRow));
    await upsertSyncState("issues", {
      lastSuccessAt: now,
      lastError: null,
      totalCount,
      truncated,
    });
    return { ok: true, count: items.length };
  } catch (err) {
    const error = errMsg(err);
    await upsertSyncState("issues", { lastError: error });
    return { ok: false, count: 0, error };
  }
}

async function syncPulls(token: string, org: string): Promise<SyncSummary["pulls"]> {
  const now = new Date();
  await upsertSyncState("pulls", { lastAttemptAt: now });
  try {
    const { items, totalCount, truncated } = await searchIssues(token, org, "pr");

    // Search 응답에는 head.sha 가 없어 상한까지 개별 조회한다.
    // 초과분·조회 실패는 headSha null → CI 상태 unknown 으로 떨어진다.
    const rows = await Promise.all(
      items.map(async (item, idx) => {
        const repo = repoFromUrl(item.repository_url);
        let headSha: string | null = null;
        if (idx < PR_HEAD_FETCH_LIMIT) {
          try {
            headSha = await getPullHeadSha(token, repo, item.number);
          } catch {
            headSha = null;
          }
        }
        return {
          id: `${repo}#${item.number}`,
          repo,
          number: item.number,
          title: item.title,
          url: item.html_url,
          author: item.user?.login ?? null,
          isDraft: item.draft ?? false,
          headSha,
          createdAt: new Date(item.created_at),
          updatedAt: new Date(item.updated_at),
        };
      }),
    );

    await replacePrs(rows);
    await upsertSyncState("pulls", {
      lastSuccessAt: now,
      lastError: null,
      totalCount,
      truncated,
    });
    return { ok: true, count: rows.length };
  } catch (err) {
    const error = errMsg(err);
    await upsertSyncState("pulls", { lastError: error });
    return { ok: false, count: 0, error };
  }
}

async function syncRuns(token: string, org: string): Promise<SyncSummary["runs"]> {
  const now = new Date();
  await upsertSyncState("runs", { lastAttemptAt: now });

  let repos: string[];
  let listComplete: boolean;
  try {
    ({ repos, complete: listComplete } = await listActiveRepos(token, org));
  } catch (err) {
    await upsertSyncState("runs", { lastError: errMsg(err) });
    return { ok: false, repos: 0, failedRepos: [] };
  }

  const failedRepos: string[] = [];
  for (const repo of repos) {
    try {
      const runs = await listWorkflowRuns(token, repo);
      await replaceRunsForRepo(repo, runs.map((r) => toRunRow(repo, r)));
    } catch {
      // 이 레포의 이전 run 은 그대로 유지된다 (§4.2 규칙 2).
      failedRepos.push(repo);
    }
  }

  // 대상 목록 밖 레포의 run 정리 — 활성 기간(7일) 밖으로 밀려난 레포의 run 이
  // 남으면 보드의 "Actions 실패" 카운트에 유령 실패로 영구히 잡힌다.
  // repos 에는 조회 실패한 레포도 포함되므로 그 이전 스냅샷은 보존된다.
  //
  // ⚠️ 목록이 페이지 상한에서 잘렸으면(complete=false) 정리하지 않는다.
  // 잘린 목록으로 NOT IN 삭제하면 상한 밖 레포의 정상 run 이 매 주기 지워진다 —
  // 유령 run 이 남는 것보다 나쁜 데이터 손실이다.
  if (listComplete) {
    try {
      await pruneRunsNotIn(repos);
    } catch (err) {
      // 정리 실패가 동기화 자체를 실패시키지는 않는다 — 다음 회차가 재시도한다.
      logger.warn("github-monitor", "prune-runs-failed", { error: errMsg(err) });
    }
  } else {
    logger.warn("github-monitor", "prune-skipped-incomplete-repo-list", {
      repos: repos.length,
    });
  }

  if (failedRepos.length > 0) {
    // 부분 실패 — lastSuccessAt 은 갱신하지 않는다 (§4.3).
    await upsertSyncState("runs", {
      lastError: `${failedRepos.length}개 레포 실패: ${failedRepos.join(", ")}`.slice(0, 200),
    });
    return { ok: false, repos: repos.length, failedRepos };
  }

  await upsertSyncState("runs", { lastSuccessAt: now, lastError: null });
  return { ok: true, repos: repos.length, failedRepos: [] };
}

async function syncBuild(token: string, nowFn: () => Date): Promise<SyncSummary["build"]> {
  const now = nowFn();
  await upsertSyncState("build", { lastAttemptAt: now });

  let head: { sha: string; committedAt: Date };
  let runs: RawRun[];
  try {
    head = await getMainHead(token, BUILD_REPO);
    runs = await listBuildRuns(token, BUILD_REPO, BUILD_WORKFLOW_FILE);
  } catch (err) {
    // ⚠️ 판정 자체를 수행하지 않는다. 관측 불가에서 판정하면
    // Build 가 계속 실패 중인데 "복구됨" 알림이 나간다.
    const error = errMsg(err);
    await upsertSyncState("build", { lastError: error });
    return { ok: false, state: null, error };
  }

  const { state, run } = judgeBuildState({
    mainHeadSha: head.sha,
    mainHeadCommittedAt: head.committedAt,
    runs: runs.map((r) => toRunRow(BUILD_REPO, r)),
    nowFn,
  });

  await upsertSyncState("build", {
    lastSuccessAt: now,
    lastError: null,
    buildState: state,
    mainHeadSha: head.sha,
    mainHeadCommittedAt: head.committedAt,
    buildRunUrl: run?.url ?? null,
    buildConclusion: run?.conclusion ?? null,
  });

  // 관측은 best-effort — 이벤트 발행 실패가 동기화를 실패시키면 안 된다.
  try {
    if (state === "build-failed") {
      await recordEvent({
        source: "github",
        severity: "critical",
        title: `${BUILD_REPO} main Build 실패`,
        detail: JSON.stringify({ sha: head.sha.slice(0, 7), url: run?.url ?? null }),
        dedupKey: BUILD_DEDUP_KEY,
      });
    } else if (state === "synced") {
      // synced 일 때만 해소한다. building·no-run·unknown 은 no-op —
      // 확인되지 않은 상태에서 해소하면 거짓 안심을 준다.
      await resolveEvent(BUILD_DEDUP_KEY);
    }
  } catch (err) {
    logger.warn("github-monitor", "build-event-record-failed", { error: errMsg(err) });
  }

  return { ok: true, state };
}

const ALL_SOURCES = ["issues", "pulls", "runs", "build"] as const;

export async function syncGithub(opts?: { nowFn?: () => Date }): Promise<SyncSummary> {
  const token = env.GITHUB_MONITOR_TOKEN;
  const nowFn = opts?.nowFn ?? (() => new Date());

  if (token == null || token === "") {
    // 기존 스냅샷을 지우지 않는다 — 보드는 "동기화 비활성" 배지를 표시한다.
    // lastAttemptAt 은 갱신해 "시도는 하고 있다"를 남긴다 (§4.2 규칙 5).
    logger.info("github-monitor", "token-not-configured", {});
    const now = nowFn();
    for (const source of ALL_SOURCES) {
      await upsertSyncState(source, { lastAttemptAt: now });
    }
    return {
      skipped: true,
      issues: { ok: false, count: 0 },
      pulls: { ok: false, count: 0 },
      runs: { ok: false, repos: 0, failedRepos: [] },
      build: { ok: false, state: null },
    };
  }

  const org = env.GITHUB_MONITOR_ORG;

  const [issues, pulls, runs, build] = await Promise.all([
    syncIssues(token, org),
    syncPulls(token, org),
    syncRuns(token, org),
    syncBuild(token, nowFn),
  ]);

  return { skipped: false, issues, pulls, runs, build };
}
