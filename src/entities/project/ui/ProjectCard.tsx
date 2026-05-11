import type { Project } from "../model/types";
import { PinIcon, CheckIcon, WarningIcon } from "@/shared/ui/icons";

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
          <h2 className="flex items-center gap-1.5 truncate text-base font-semibold">
            {project.isPinned ? (
              <>
                <PinIcon size={14} className="shrink-0 text-amber-600" />
                <span className="sr-only">pinned</span>
              </>
            ) : null}
            <span className="truncate">{project.displayName}</span>
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
              ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700"
              : "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700"
          }
        >
          {allHealthy ? (
            <CheckIcon size={13} />
          ) : (
            <WarningIcon size={13} />
          )}
          <span className="tabular-nums">
            {runningContainers}/{totalContainers} running
          </span>
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}
