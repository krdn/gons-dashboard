"use client";
import type { PluginMeta } from "@/entities/plugin/client";
import { pluginStatus } from "../lib/filterPlugins";
import { PluginStatusBadge } from "./PluginStatusBadge";

/** 0이 아닌 구성요소 축만 칩으로. mcp(boolean)는 true 일 때만. */
function countChips(p: PluginMeta): string[] {
  const chips: string[] = [];
  if (p.counts.skills) chips.push(`${p.counts.skills} skills`);
  if (p.counts.agents) chips.push(`${p.counts.agents} agents`);
  if (p.counts.commands) chips.push(`${p.counts.commands} cmds`);
  if (p.counts.hooks) chips.push(`${p.counts.hooks} hooks`);
  if (p.counts.mcp) chips.push("MCP");
  return chips;
}

export function PluginList({
  plugins,
  selectedId,
  onSelect,
}: {
  plugins: PluginMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {plugins.map((p) => {
        const chips = countChips(p);
        const selected = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              aria-pressed={selected}
              className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
                  : "border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-[var(--color-text)]">{p.name}</span>
                <PluginStatusBadge status={pluginStatus(p)} />
              </span>
              {chips.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                    >
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
