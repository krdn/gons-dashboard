"use client";
import { useCallback, useMemo, useState } from "react";
import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";
import { filterPlugins, type StatusFilter } from "../lib/filterPlugins";
import { groupPlugins } from "../lib/groupPlugins";
import { PluginGroupSection } from "./PluginGroupSection";
import { PluginDetail } from "./PluginDetail";

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "active", label: "활성" },
  { value: "dormant", label: "휴면" },
  { value: "missing", label: "경로 없음" },
];

export function PluginCatalog({
  plugins,
  marketplaces,
}: {
  plugins: PluginMeta[];
  marketplaces: Record<string, PluginMarketplaceMeta>;
}) {
  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 사용자가 명시적으로 접은 marketplace slug 집합. 기본 = 빈 집합(전체 펼침).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => filterPlugins(plugins, query, marketplace, status),
    [plugins, query, marketplace, status],
  );
  const groups = useMemo(() => groupPlugins(filtered, marketplaces), [filtered, marketplaces]);

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

  const selected = useMemo(
    () => plugins.find((p) => p.id === selectedId) ?? null,
    [plugins, selectedId],
  );

  // marketplace 칩 — catalog 메타 count desc. "전체" 가 맨 앞.
  const marketplaceChips = useMemo(
    () =>
      [{ slug: "all", label: "전체" }].concat(
        Object.entries(marketplaces)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([slug, m]) => ({ slug, label: m.label })),
      ),
    [marketplaces],
  );

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="plugin 이름·설명 검색"
          aria-label="plugin 검색"
          className="w-full rounded-lg border border-[var(--color-hairline)] bg-white px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus-visible:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        />
        <div role="group" aria-label="상태 필터" className="flex flex-wrap items-center gap-1 text-xs">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatus(chip.value)}
              aria-pressed={status === chip.value}
              className={`rounded-md border px-2 py-1 transition-colors ${
                status === chip.value
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[var(--color-text-subtle)]">{filtered.length}</span>
        </div>
        <div role="group" aria-label="마켓플레이스 필터" className="flex flex-wrap items-center gap-1 text-xs">
          {marketplaceChips.map((chip) => (
            <button
              key={chip.slug}
              type="button"
              onClick={() => setMarketplace(chip.slug)}
              aria-pressed={marketplace === chip.slug}
              className={`rounded-md border px-2 py-1 transition-colors ${
                marketplace === chip.slug
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
            조건에 맞는 plugin 이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <PluginGroupSection
                key={g.slug}
                group={g}
                expanded={isExpanded(g.slug)}
                onToggle={toggle}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        )}
      </aside>
      <PluginDetail plugin={selected} />
    </div>
  );
}
