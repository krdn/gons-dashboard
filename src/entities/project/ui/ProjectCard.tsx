import type { Project } from "../model/types";

type Props = {
  project: Pick<Project, "displayName" | "description" | "isPinned" | "composeProject">;
  totalContainers: number;
  runningContainers: number;
  warningCount: number;
  children?: React.ReactNode;
};

export function ProjectCard({
  project,
  totalContainers,
  runningContainers,
  warningCount,
  children,
}: Props) {
  const allHealthy = warningCount === 0 && runningContainers === totalContainers;
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm">
      <header className="flex flex-col gap-3 border-b border-zinc-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            {project.isPinned ? <span aria-label="pinned">📌 </span> : null}
            {project.displayName}
          </h2>
          {project.description ? (
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              {project.description}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-xs text-zinc-400">
            {project.composeProject}
          </p>
        </div>
        <div
          className={
            allHealthy
              ? "shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700"
              : "shrink-0 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700"
          }
        >
          {allHealthy ? "✓" : "⚠"} {runningContainers}/{totalContainers} running
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}
