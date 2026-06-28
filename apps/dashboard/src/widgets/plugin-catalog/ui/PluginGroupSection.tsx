"use client";
import type { PluginGroup } from "../lib/groupPlugins";
import { PluginList } from "./PluginList";

export function PluginGroupSection({
  group,
  expanded,
  onToggle,
  selectedId,
  onSelect,
}: {
  group: PluginGroup;
  expanded: boolean;
  onToggle: (slug: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onToggle(group.slug)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-left text-xs font-semibold text-[var(--color-text-muted)]"
      >
        <span aria-hidden className="font-mono text-[10px]">
          {expanded ? "▾" : "▸"}
        </span>
        {group.label}
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          {group.plugins.length}
        </span>
      </button>
      {expanded && (
        <PluginList plugins={group.plugins} selectedId={selectedId} onSelect={onSelect} />
      )}
    </section>
  );
}
