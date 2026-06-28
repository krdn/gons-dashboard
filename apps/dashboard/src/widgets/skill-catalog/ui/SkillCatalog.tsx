"use client";
import { useCallback, useMemo, useState } from "react";
import type { SkillMeta, SkillCategoryMetaMap } from "@/entities/skill/client";
import { filterSkills, type SourceFilter } from "../lib/filterSkills";
import { groupSkills } from "../lib/groupSkills";
import { SkillGroupSection } from "./SkillGroupSection";
import { SkillDetail } from "./SkillDetail";

const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "standalone", label: "직접 설치" },
  { value: "personal", label: "개인" },
];

export function SkillCatalog({
  skills,
  categories,
}: {
  skills: SkillMeta[];
  categories: SkillCategoryMetaMap;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // 사용자가 명시적으로 접은 카테고리 slug 집합. 기본 = 빈 집합(전체 펼침).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => filterSkills(skills, query, source),
    [skills, query, source],
  );

  const groups = useMemo(
    () => groupSkills(filtered, categories),
    [filtered, categories],
  );

  // 검색 중에는 접힘을 무시하고 강제 펼침 — 접힌 섹션에 숨은 결과 방지.
  const searching = query.trim() !== "";
  const isExpanded = useCallback(
    (slug: string) => searching || !collapsed.has(slug),
    [searching, collapsed],
  );

  const toggle = useCallback((slug: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const selectedMeta = useMemo(
    () => skills.find((s) => s.name === selectedName) ?? null,
    [skills, selectedName],
  );
  const selectedCategoryLabel = selectedMeta
    ? (categories[selectedMeta.category]?.label ?? null)
    : null;

  const allCollapsed = collapsed.size === groups.length && groups.length > 0;
  const toggleAll = useCallback(() => {
    setCollapsed((prev) =>
      prev.size >= groups.length ? new Set() : new Set(groups.map((g) => g.slug)),
    );
  }, [groups]);

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

        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
            조건에 맞는 스킬이 없습니다.
          </p>
        ) : (
          <>
            {!searching && (
              <button
                type="button"
                onClick={toggleAll}
                className="self-start font-mono text-[10px] text-[var(--color-text-subtle)] underline-offset-2 hover:underline"
              >
                {allCollapsed ? "모두 펼치기" : "모두 접기"}
              </button>
            )}
            <div className="flex flex-col gap-2">
              {groups.map((g) => (
                <SkillGroupSection
                  key={g.slug}
                  group={g}
                  expanded={isExpanded(g.slug)}
                  onToggle={toggle}
                  selectedName={selectedName}
                  onSelect={setSelectedName}
                />
              ))}
            </div>
          </>
        )}
      </aside>
      <SkillDetail meta={selectedMeta} categoryLabel={selectedCategoryLabel} />
    </div>
  );
}
