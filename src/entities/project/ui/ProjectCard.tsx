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
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            {project.isPinned ? "📌 " : ""}
            {project.displayName}
          </h2>
          {project.description ? (
            <p className="text-sm text-zinc-500">{project.description}</p>
          ) : null}
        </div>
        <div className="text-sm">
          {allHealthy ? "✓" : "⚠"} {runningContainers}/{totalContainers} running
        </div>
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}
