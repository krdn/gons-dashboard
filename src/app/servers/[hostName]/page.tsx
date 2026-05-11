// 호스트 상세 페이지 — Sprint 2.5 / Task 19.
// 모든 layer 통합: shared(auth) + entities(host/container/project)
//   + features(container-list/container-actions) + widgets(skeleton).
//
// dedup 정책:
//   `getHostsWithSummary`와 동일한 hidden-thrash 방지를 사용한다.
//   - display용: getProjects(hostId) — isHidden=false 만
//   - dedup용:   getProjectComposeKeys(hostId) — hidden 포함 전체 key set
//   둘을 분리하지 않으면, hidden project가 매번 unknown으로 분류돼
//   onConflictDoUpdate가 트리거되는 thrash가 재현된다.
//
// 권한 boundary:
//   page는 read-only RSC. session 정보로 adminFlag만 계산해 ActionButtons
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
  upsertProjectFromContainer,
  type Project,
} from "@/entities/project";
import {
  groupByProject,
  ProjectGroupSection,
  StandaloneSection,
} from "@/features/container-list";
import {
  ActionButtons,
  AuditLogPanel,
  isAdmin,
} from "@/features/container-actions";

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

  // dedup은 hidden 포함 전체 key set으로 — hidden project가 매번 unknown으로
  // 분류돼 upsert가 반복되는 것을 막는다 (Task 16 fix와 동일 패턴).
  const [visibleProjects, allComposeKeys] = await Promise.all([
    getProjects(host.id),
    getProjectComposeKeys(host.id),
  ]);
  const knownComposeKeys = new Set(allComposeKeys);
  const unknownKeys = Array.from(
    new Set(
      containers
        .map((c) => c.composeProject)
        .filter((k): k is string => k != null && !knownComposeKeys.has(k)),
    ),
  );
  let allProjects: Project[] = visibleProjects;
  if (unknownKeys.length > 0) {
    const created = await Promise.all(
      unknownKeys.map((composeProject) =>
        upsertProjectFromContainer({
          hostId: host.id,
          hostName: host.name,
          composeProject,
        }),
      ),
    );
    // 화이트리스트 외 compose는 upsert가 null 반환 → 새 project row 생성 안 함
    // (Task 6에서 groupByProject가 standalone 그룹으로 합류 처리)
    const createdNonNull = created.filter((p): p is Project => p !== null);
    allProjects = [...visibleProjects, ...createdNonNull];
  }

  const groups = groupByProject(containers, allProjects);
  const standalone = groups.find((g) => g.isStandalone);
  const named = groups.filter((g) => !g.isStandalone);
  const runningCount = containers.filter((c) => c.state === "running").length;
  const issueCount = groups.reduce((sum, g) => sum + g.warningCount, 0);
  const staleCount = groups.filter((g) => g.isStale).length;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-zinc-950 sm:px-6 dark:text-zinc-100">
      <header className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Link
              href="/"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              ← dashboard
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <HostBadge host={host} status={daemonError ? "down" : "ok"} />
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-mono text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                {host.dockerContext}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right sm:min-w-80">
            <SummaryStat label="containers" value={`${runningCount}/${containers.length}`} />
            <SummaryStat label="issues" value={String(issueCount)} tone={issueCount > 0 ? "warn" : "ok"} />
            <SummaryStat label="stale" value={String(staleCount)} tone={staleCount > 0 ? "warn" : "ok"} />
          </div>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Last refreshed {new Date().toLocaleTimeString("ko-KR")} · read-only
          view for all signed-in users · actions require admin allowlist
        </p>
      </header>

      {daemonError ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950">
          <p className="font-semibold text-rose-800 dark:text-rose-300">
            Docker 연결 실패
          </p>
          <p className="mt-1 break-all text-rose-700 dark:text-rose-400">
            {daemonError}
          </p>
        </section>
      ) : null}

      {named.map((g) => (
        <ProjectGroupSection
          key={g.composeProject}
          group={g}
          renderActions={(containerId, containerName) => {
            const c = g.containers.find((x) => x.id === containerId);
            if (!c) return null;
            return (
              <ActionButtons
                hostId={host.id}
                containerId={containerId}
                containerName={containerName}
                state={c.state}
                isAdmin={adminFlag}
              />
            );
          }}
        />
      ))}

      {standalone ? (
        <StandaloneSection
          group={standalone}
          renderActions={(containerId, containerName) => {
            const c = standalone.containers.find((x) => x.id === containerId);
            if (!c) return null;
            return (
              <ActionButtons
                hostId={host.id}
                containerId={containerId}
                containerName={containerName}
                state={c.state}
                isAdmin={adminFlag}
              />
            );
          }}
        />
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
        <h2 className="mb-3 text-sm font-semibold">최근 액션 5건</h2>
        <AuditLogPanel hostId={host.id} limit={5} />
      </section>
    </main>
  );
}

function SummaryStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-300"
        : "text-zinc-950 dark:text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className={`font-mono text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
    </div>
  );
}
