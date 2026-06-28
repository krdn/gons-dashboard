"use client";
import { useMemo, useState } from "react";
import type { SkillMeta } from "@/entities/skill/client";
import { filterSkills, type SourceFilter } from "../lib/filterSkills";
import { SkillList } from "./SkillList";
import { SkillDetail } from "./SkillDetail";

const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "standalone", label: "직접 설치" },
  { value: "personal", label: "개인" },
];

export function SkillCatalog({ skills }: { skills: SkillMeta[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterSkills(skills, query, source),
    [skills, query, source],
  );

  const selectedMeta = useMemo(
    () => skills.find((s) => s.name === selectedName) ?? null,
    [skills, selectedName],
  );

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="스킬 이름·설명 검색"
          aria-label="스킬 검색"
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
        <SkillList skills={filtered} selectedName={selectedName} onSelect={setSelectedName} />
      </aside>
      <SkillDetail meta={selectedMeta} />
    </div>
  );
}
