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
    <section className="overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-white text-[var(--color-text)] shadow-sm">
      <header className="flex flex-col gap-3 border-b border-[var(--color-hairline)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-base font-semibold">
            {project.isPinned ? (
              <>
                <PinIcon size={14} className="shrink-0 text-[var(--color-warn)]" />
                <span className="sr-only">pinned</span>
              </>
            ) : null}
            <span className="truncate">{project.displayName}</span>
          </h2>
          {project.description ? (
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-subtle)]">
              {project.description}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
            {project.composeProject}
          </p>
        </div>
        <div
          className={
            allHealthy
              ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[oklch(96%_0.04_155)] px-3 py-1 text-sm font-medium text-[var(--color-severity-ok)]"
              : "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[oklch(96%_0.04_70)] px-3 py-1 text-sm font-medium text-[var(--color-warn)]"
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
