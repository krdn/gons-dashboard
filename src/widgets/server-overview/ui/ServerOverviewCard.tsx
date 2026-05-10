import "server-only";
import Link from "next/link";
import { getHostsWithSummary } from "@/features/host-catalog";
import { HostBadge } from "@/entities/host";
import { ServerOverviewError } from "./ServerOverviewError";

export async function ServerOverviewCard() {
  const summaries = await getHostsWithSummary();
  if (summaries.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">
          등록된 호스트가 없습니다. <code>pnpm db:seed:hosts</code>를 실행하세요.
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-3">
      {summaries.map((s) =>
        !s.daemonOk ? (
          <ServerOverviewError
            key={s.host.id}
            hostName={s.host.name}
            message={s.errorMessage ?? "unknown"}
            fetchedAt={s.fetchedAt}
          />
        ) : (
          <section
            key={s.host.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <header className="mb-3 flex items-center justify-between">
              <HostBadge host={s.host} status="ok" />
              <Link
                href={`/servers/${s.host.name}`}
                className="text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                상세 보기 →
              </Link>
            </header>
            <ul className="space-y-1 text-sm">
              {s.groups.map((g) => {
                const ok = g.warningCount === 0;
                return (
                  <li
                    key={g.composeProject}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden>{ok ? "✓" : "⚠"}</span>
                      <span
                        className={`truncate font-mono ${g.isPinned ? "font-semibold" : ""}`}
                      >
                        {g.displayName}
                      </span>
                    </span>
                    <span
                      className={
                        ok
                          ? "text-zinc-600 dark:text-zinc-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {g.runningCount}/{g.totalCount}{" "}
                      {ok ? "running" : `· ${g.warningCount} issue${g.warningCount > 1 ? "s" : ""}`}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              Last updated: {new Date(s.fetchedAt).toLocaleTimeString("ko-KR")}
            </p>
          </section>
        ),
      )}
    </div>
  );
}
