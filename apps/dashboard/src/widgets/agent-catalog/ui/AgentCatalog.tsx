"use client";
import { useMemo, useState } from "react";
import type { AgentMeta } from "@/entities/agent/client";
import {
  filterAgents,
  type SourceFilter,
  type ModelFilter,
} from "../lib/filterAgents";
import { AgentList } from "./AgentList";
import { AgentDetail } from "./AgentDetail";

const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "personal", label: "개인" },
  { value: "framework", label: "프레임워크" },
];

const MODEL_CHIPS: { value: ModelFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
  { value: "inherit", label: "상속" },
];

export function AgentCatalog({ agents }: { agents: AgentMeta[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [model, setModel] = useState<ModelFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterAgents(agents, query, source, model),
    [agents, query, source, model],
  );

  const selected = useMemo(
    () => filtered.find((a) => a.name === selectedName) ?? null,
    [filtered, selectedName],
  );

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="에이전트 이름·설명·도구 검색"
          aria-label="에이전트 검색"
          className="w-full rounded-lg border border-[var(--color-hairline)] bg-white px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus-visible:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        />
        <div role="group" aria-label="출처 필터" className="flex items-center gap-1 text-xs">
          {SOURCE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setSource(chip.value)}
              aria-pressed={source === chip.value}
              className={`rounded-md border px-2 py-1 transition-colors ${
                source === chip.value
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[var(--color-text-subtle)]">
            {filtered.length}
          </span>
        </div>
        <div role="group" aria-label="모델 필터" className="flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 text-[10px] text-[var(--color-text-subtle)]">모델</span>
          {MODEL_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setModel(chip.value)}
              aria-pressed={model === chip.value}
              className={`rounded-md border px-2 py-1 transition-colors ${
                model === chip.value
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <AgentList
          agents={filtered}
          selectedName={selectedName}
          onSelect={setSelectedName}
        />
      </aside>
      <AgentDetail meta={selected} />
    </div>
  );
}
