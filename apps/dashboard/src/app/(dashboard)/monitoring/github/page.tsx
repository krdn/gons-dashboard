// /monitoring/github — GitHub 관제 보드 (이슈 #323).
// 갱신: AutoRefresh 15초 폴링. 데이터는 5분 주기 cron 이 적재한 스냅샷이다.
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { env } from "@/shared/config/env";
import {
  listOpenIssues,
  listOpenPrs,
  listRecentRuns,
  getSyncStates,
  getBuildState,
} from "@/entities/github-activity/server";
import { type PrCiStatus, type SyncSource } from "@/entities/github-activity/client";
import {
  derivePrCiStatus,
  isPrStale,
  isIssueTriageStale,
  deriveSyncDisplayState,
  normalizeRunOutcome,
} from "@/features/github-monitor/lib";
import {
  AutoRefresh,
  BuildStateCard,
  IssuesBoard,
  PullRequestsBoard,
  SyncStateBadge,
  WorkflowRunsBoard,
} from "@/widgets/monitoring";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function GithubMonitoringPage() {
  // ⚠️ 인증은 layout 이 아니라 여기서 한다 — layout 인증은 Next 에서
  // 라우트별 보호를 보장하지 않는다.
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [issues, prs, runs, syncStates, build] = await Promise.all([
    listOpenIssues(),
    listOpenPrs(),
    listRecentRuns(),
    getSyncStates(),
    getBuildState(),
  ]);

  const tokenConfigured = env.GITHUB_MONITOR_TOKEN != null && env.GITHUB_MONITOR_TOKEN !== "";
  const stateOf = (source: SyncSource) =>
    deriveSyncDisplayState(syncStates.find((s) => s.source === source) ?? null, {
      tokenConfigured,
    });
  const errorOf = (source: SyncSource) =>
    syncStates.find((s) => s.source === source)?.lastError ?? null;

  const ciStatus: Record<string, PrCiStatus> = {};
  for (const pr of prs) ciStatus[pr.id] = derivePrCiStatus(pr, runs);

  const stalePrIds = new Set(prs.filter((pr) => isPrStale(pr)).map((pr) => pr.id));
  const staleIssueIds = new Set(
    issues.filter((i) => isIssueTriageStale(i)).map((i) => i.id),
  );

  // ⚠️ conclusion === "failure" 만 세면 timed_out·startup_failure·action_required 가
  // 누락된다. 정규화 함수를 단일 기준으로 쓴다.
  const failingRuns = runs.filter((r) => normalizeRunOutcome(r) === "failure").length;
  const failingPrs = Object.values(ciStatus).filter((s) => s === "failing").length;

  // 스냅샷이 잘렸는지 — 보드가 전수인 척하면 안 된다 (스펙 §3).
  const truncationOf = (source: SyncSource) => {
    const s = syncStates.find((x) => x.source === source);
    if (s?.truncated !== true || s.totalCount == null) return null;
    return s.totalCount;
  };

  const org = env.GITHUB_MONITOR_ORG;
  const searchUrl = (kind: "issue" | "pr") =>
    `https://github.com/search?q=${encodeURIComponent(`org:${org} is:${kind} is:open`)}&type=issues`;

  return (
    <PageContainer>
      <PageHeader title="GitHub 관제" subtitle="krdn org 의 이슈·PR·Actions 현황" />
      <AutoRefresh intervalMs={15_000} />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
          <p className="text-xs text-[var(--color-text-muted)]">열린 이슈</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{issues.length}</p>
          {truncationOf("issues") != null && (
            <p className="text-xs text-[var(--color-text-muted)]">
              표시 {issues.length} / 전체 {truncationOf("issues")} ·{" "}
              <a href={searchUrl("issue")} target="_blank" rel="noreferrer" className="underline">
                GitHub 에서 더 보기
              </a>
            </p>
          )}
          <SyncStateBadge state={stateOf("issues")} detail={errorOf("issues")} />
        </div>
        <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
          <p className="text-xs text-[var(--color-text-muted)]">열린 PR (CI 실패)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {prs.length}
            {failingPrs > 0 && <span className="ml-1 text-base text-red-700">({failingPrs})</span>}
          </p>
          {truncationOf("pulls") != null && (
            <p className="text-xs text-[var(--color-text-muted)]">
              표시 {prs.length} / 전체 {truncationOf("pulls")} ·{" "}
              <a href={searchUrl("pr")} target="_blank" rel="noreferrer" className="underline">
                GitHub 에서 더 보기
              </a>
            </p>
          )}
          <SyncStateBadge state={stateOf("pulls")} detail={errorOf("pulls")} />
        </div>
        <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Actions 실패</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{failingRuns}</p>
          <SyncStateBadge state={stateOf("runs")} detail={errorOf("runs")} />
        </div>
        <div>
          <BuildStateCard build={build} />
          <SyncStateBadge state={stateOf("build")} detail={errorOf("build")} />
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <WorkflowRunsBoard runs={runs} />
        <PullRequestsBoard prs={prs} ciStatus={ciStatus} staleIds={stalePrIds} />
        <IssuesBoard issues={issues} staleIds={staleIssueIds} />
      </div>
    </PageContainer>
  );
}
