"use client";
import { useId } from "react";
import type { SkillGroup } from "../lib/groupSkills";
import { SkillList } from "./SkillList";

export function SkillGroupSection({
  group,
  expanded,
  onToggle,
  selectedName,
  onSelect,
}: {
  group: SkillGroup;
  expanded: boolean;
  onToggle: (slug: string) => void;
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  const listId = useId();
  return (
    <section>
      <button
        type="button"
        onClick={() => onToggle(group.slug)}
        aria-expanded={expanded}
        aria-controls={listId}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
      >
        <span
          aria-hidden="true"
          className={`text-[10px] text-[var(--color-text-subtle)] transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {group.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--color-text-subtle)]">
          {group.skills.length}
        </span>
      </button>
      <div id={listId} hidden={!expanded} className="mt-1 pl-2">
        {expanded && (
          <SkillList skills={group.skills} selectedName={selectedName} onSelect={onSelect} />
        )}
      </div>
    </section>
  );
}
