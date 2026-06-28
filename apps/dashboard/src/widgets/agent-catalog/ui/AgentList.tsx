"use client";
import { SOURCE_LABEL, type AgentMeta } from "@/entities/agent/client";
import { ModelBadge } from "./ModelBadge";

export function AgentList({
  agents,
  selectedName,
  onSelect,
}: {
  agents: AgentMeta[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
        조건에 맞는 에이전트가 없습니다.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col gap-1">
      {agents.map((a) => {
        const active = a.name === selectedName;
        return (
          <li key={a.name}>
            <button
              type="button"
              onClick={() => onSelect(a.name)}
              aria-current={active ? "true" : undefined}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
                  : "border-transparent hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <ModelBadge model={a.model} />
                  <span className="truncate text-sm font-medium text-[var(--color-text)]">
                    {a.name}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-subtle)]">
                  {SOURCE_LABEL[a.source]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                {a.description}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
