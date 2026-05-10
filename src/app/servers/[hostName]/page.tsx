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

import { notFound } from "next/navigation";
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
  const { hostName } = await params;
  const host = await getHostByName(hostName);
  if (!host) notFound();

  const session = await auth();
  const adminFlag = isAdmin(
    session?.user?.email ?? null,
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
        upsertProjectFromContainer({ hostId: host.id, composeProject }),
      ),
    );
    // 새로 생성된 project는 visible default (isHidden=false)
    allProjects = [...visibleProjects, ...created];
  }

  const groups = groupByProject(containers, allProjects);
  const standalone = groups.find((g) => g.isStandalone);
  const named = groups.filter((g) => !g.isStandalone);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <HostBadge host={host} status={daemonError ? "down" : "ok"} />
        <span className="text-xs text-zinc-500">
          context: <code>{host.dockerContext}</code> ·{" "}
          {new Date().toLocaleTimeString("ko-KR")}
        </span>
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

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-2 text-sm font-semibold">최근 액션 5건</h2>
        <AuditLogPanel hostId={host.id} limit={5} />
      </section>
    </main>
  );
}
