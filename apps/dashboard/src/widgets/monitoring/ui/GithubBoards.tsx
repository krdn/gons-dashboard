// GitHub 드릴다운 표 3개 — Actions / PR / 이슈.
// 각 행은 GitHub 원본으로 링크한다. 보드는 전수 목록이 아니라 판단 도구다.
import { normalizeRunOutcome } from "@/features/github-monitor/lib";
import {
  type GithubIssue,
  type GithubPullRequest,
  type GithubWorkflowRun,
  type PrCiStatus,
} from "@/entities/github-activity/client";

const MAX_ROWS = 20;

const CI_LABEL: Record<PrCiStatus, string> = {
  passing: "통과",
  failing: "실패",
  running: "진행 중",
  unknown: "—",
};

const CI_TONE: Record<PrCiStatus, string> = {
  passing: "text-emerald-700",
  failing: "text-red-700",
  running: "text-blue-700",
  unknown: "text-neutral-400",
};

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <h2 className="text-sm font-semibold">
        {title} <span className="text-[var(--color-text-muted)]">({count})</span>
      </h2>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-4 text-sm text-[var(--color-text-muted)]">{label}</p>;
}

export function WorkflowRunsBoard({ runs }: { runs: GithubWorkflowRun[] }) {
  // 실패를 위로 — 판단이 필요한 것부터 보여준다.
  // ⚠️ conclusion === "failure" 만 보면 timed_out·startup_failure 가 빠진다.
  const isFail = (r: GithubWorkflowRun) => normalizeRunOutcome(r) === "failure";
  const sorted = [...runs].sort((a, b) => {
    const d = (isFail(a) ? 0 : 1) - (isFail(b) ? 0 : 1);
    if (d !== 0) return d;
    return (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0);
  });

  return (
    <Section title="Actions 실행" count={runs.length}>
      {sorted.length === 0 ? (
        <Empty label="표시할 실행이 없습니다." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-muted)]">
              <th className="py-1">레포</th>
              <th>워크플로</th>
              <th>상태</th>
              <th>브랜치</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, MAX_ROWS).map((r) => (
              <tr key={r.id} className="border-t border-[var(--color-hairline)]">
                <td className="py-1">{r.repo}</td>
                <td>
                  <a href={r.url} target="_blank" rel="noreferrer" className="underline">
                    {r.workflowName}
                  </a>
                </td>
                <td className={isFail(r) ? "text-red-700" : ""}>{r.conclusion ?? r.status}</td>
                <td className="font-mono text-xs">{r.headBranch ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function PullRequestsBoard({
  prs,
  ciStatus,
  staleIds,
}: {
  prs: GithubPullRequest[];
  ciStatus: Record<string, PrCiStatus>;
  staleIds: Set<string>;
}) {
  return (
    <Section title="열린 PR" count={prs.length}>
      {prs.length === 0 ? (
        <Empty label="열린 PR 이 없습니다." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-muted)]">
              <th className="py-1">레포</th>
              <th>제목</th>
              <th>CI</th>
              <th>작성자</th>
            </tr>
          </thead>
          <tbody>
            {prs.slice(0, MAX_ROWS).map((pr) => {
              const ci = ciStatus[pr.id] ?? "unknown";
              return (
                <tr key={pr.id} className="border-t border-[var(--color-hairline)]">
                  <td className="py-1">{pr.repo}</td>
                  <td>
                    <a href={pr.url} target="_blank" rel="noreferrer" className="underline">
                      {pr.title}
                    </a>
                    {pr.isDraft && (
                      <span className="ml-1 text-xs text-[var(--color-text-muted)]">draft</span>
                    )}
                    {staleIds.has(pr.id) && (
                      <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">
                        정체
                      </span>
                    )}
                  </td>
                  <td className={CI_TONE[ci]}>{CI_LABEL[ci]}</td>
                  <td>{pr.author ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function IssuesBoard({
  issues,
  staleIds,
}: {
  issues: GithubIssue[];
  staleIds: Set<string>;
}) {
  // 정체된 것을 위로.
  const sorted = [...issues].sort((a, b) => {
    const aStale = staleIds.has(a.id) ? 0 : 1;
    const bStale = staleIds.has(b.id) ? 0 : 1;
    if (aStale !== bStale) return aStale - bStale;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return (
    <Section title="열린 이슈" count={issues.length}>
      {sorted.length === 0 ? (
        <Empty label="열린 이슈가 없습니다." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-muted)]">
              <th className="py-1">레포</th>
              <th>제목</th>
              <th>라벨</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, MAX_ROWS).map((issue) => (
              <tr key={issue.id} className="border-t border-[var(--color-hairline)]">
                <td className="py-1">{issue.repo}</td>
                <td>
                  <a href={issue.url} target="_blank" rel="noreferrer" className="underline">
                    {issue.title}
                  </a>
                  {staleIds.has(issue.id) && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">
                      정체
                    </span>
                  )}
                </td>
                <td className="text-xs">{issue.labels.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
