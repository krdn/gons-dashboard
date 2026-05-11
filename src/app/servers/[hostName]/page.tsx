// 호스트 상세 페이지.
// 모든 layer 통합: shared(auth) + entities(host/container/project)
//   + features(container-list/container-actions) + widgets(host-dashboard).
//
// dedup 정책:
//   `getHostsWithSummary`와 동일한 hidden-thrash 방지를 사용한다.
//   - display용: getProjects(hostId) — isHidden=false 만
//   - dedup용:   getProjectComposeKeys(hostId) — hidden 포함 전체 key set
//   둘을 분리하지 않으면, hidden project가 매번 unknown으로 분류돼
//   onConflictDoUpdate가 트리거되는 thrash가 재현된다.
//
// 권한 boundary:
//   page는 read-only RSC. session 정보로 adminFlag만 계산해 HostDashboard
//   prop으로 전달한다. 실제 mutation 권한 체크/audit은 Server Action
//   (restartContainer/startContainer/stopContainer) 내부에서 다시 수행된다
//   — client에서 prop을 위조해도 서버에서 거절된다.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/shared/lib/auth";
import { getHostByName, HostBadge } from "@/entities/host";
import { listContainers, type ContainerSummary } from "@/entities/container";
import {
  getProjects,
  getProjectComposeKeys,
  syncMissingProjects,
  type Project,
} from "@/entities/project";
import { groupByProject } from "@/features/container-list";
import { AuditLogPanel, isAdmin } from "@/features/container-actions";
import { HostDashboard } from "@/widgets/host-dashboard";
import { HelpHint } from "@/shared/ui/HelpHint";
import { ArrowLeftIcon } from "@/shared/ui/icons";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ hostName: string }> };

export default async function HostDetailPage({ params }: Props) {
  // Read 권한도 인증 사용자 only — audit_logs.userEmail (PII), Docker stderr,
  // 컨테이너 인벤토리가 모두 노출되므로 unauthenticated 접근을 차단한다.
  // 메인 페이지(`src/app/page.tsx:29`)와 동일 패턴.
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { hostName } = await params;
  const host = await getHostByName(hostName);
  if (!host) notFound();

  const adminFlag = isAdmin(
    session.user.email ?? null,
    process.env.ADMIN_EMAILS ?? "",
  );

  let containers: ContainerSummary[] = [];
  let daemonError: string | null = null;
  try {
    containers = await listContainers({
      hostId: host.id,
      dockerContext: host.dockerContext,
    });
  } catch (err) {
    daemonError = err instanceof Error ? err.message : String(err);
  }

  const [visibleProjects, allComposeKeys] = await Promise.all([
    getProjects(host.id),
    getProjectComposeKeys(host.id),
  ]);
  const created = await syncMissingProjects({
    hostId: host.id,
    hostName: host.name,
    observed: containers
      .map((c) => c.composeProject)
      .filter((k): k is string => k != null),
    knownComposeKeys: allComposeKeys,
  });
  const allProjects: Project[] = [...visibleProjects, ...created];

  const groups = groupByProject(containers, allProjects);
  const runningCount = containers.filter((c) => c.state === "running").length;
  const issueCount = groups.reduce((sum, g) => sum + g.warningCount, 0);
  const staleCount = groups.filter((g) => g.isStale).length;
  const refreshedAtIso = new Date().toISOString();

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-[var(--color-text)] sm:px-6">
      <header className="rounded-xl border border-[var(--color-hairline)] bg-white p-5 shadow-sm">
        <h1 className="sr-only">{host.name} · 서버 상세</h1>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-[var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            >
              <ArrowLeftIcon size={12} />
              dashboard
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <HostBadge host={host} status={daemonError ? "down" : "ok"} />
              <span
                className="rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-2.5 py-1 font-mono text-xs text-[var(--color-text-muted)]"
                title="이 호스트의 Docker context. dlocal/dserver alias 와 매칭됩니다."
              >
                {host.dockerContext}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right sm:min-w-80">
            <SummaryStat
              label="containers"
              value={`${runningCount}/${containers.length}`}
              hint="실행 중 컨테이너 / 전체 등록 컨테이너. running 만 'live'로 인정합니다."
            />
            <SummaryStat
              label="issues"
              value={String(issueCount)}
              tone={issueCount > 0 ? "warn" : "ok"}
              hint="exited / restarting / paused / dead 상태의 컨테이너 수. 0이면 정상."
            />
            <SummaryStat
              label="stale"
              value={String(staleCount)}
              tone={staleCount > 0 ? "warn" : "ok"}
              hint="화이트리스트엔 등록되어 있으나 현재 실행 중인 컨테이너가 0개인 프로젝트 수."
            />
          </div>
        </div>
        <p className="mt-4 text-xs text-[var(--color-text-subtle)]">
          read-only view for all signed-in users · actions require admin
          allowlist · 30초마다 자동 새로고침 ·{" "}
          <kbd className="inline-flex min-w-[1.25rem] items-center justify-center rounded border border-zinc-300 bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
            ?
          </kbd>
          {" "}로 단축키 보기
        </p>
      </header>

      {daemonError ? (
        <section className="rounded-xl border border-[var(--color-severity-high)] bg-[oklch(96%_0.04_28)] p-4 text-sm">
          <p className="font-semibold text-[var(--color-severity-high)]">Docker 연결 실패</p>
          <p className="mt-1 break-all text-[var(--color-severity-high)]">{daemonError}</p>
        </section>
      ) : null}

      <HostDashboard
        hostId={host.id}
        adminFlag={adminFlag}
        groups={groups}
        refreshedAtIso={refreshedAtIso}
      />

      <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4 text-[var(--color-text)] shadow-sm">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          최근 액션 5건
          <HelpHint hint="이 호스트에서 발생한 start/stop/restart 액션 이력. 클라이언트가 아닌 서버 audit_logs 테이블 기준입니다." />
        </h2>
        <AuditLogPanel hostId={host.id} limit={5} />
      </section>
    </main>
  );
}

function SummaryStat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
  hint?: string;
}) {
  const toneClass =
    tone === "ok"
      ? "text-[var(--color-severity-ok)]"
      : tone === "warn"
        ? "text-[var(--color-warn)]"
        : "text-[var(--color-text)]";
  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2">
      <div className={`font-mono text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      <div className="mt-0.5 flex items-center justify-end gap-1 text-tiny uppercase tracking-wide text-[var(--color-text-subtle)]">
        {label}
        {hint ? <HelpHint hint={hint} size={12} /> : null}
      </div>
    </div>
  );
}
