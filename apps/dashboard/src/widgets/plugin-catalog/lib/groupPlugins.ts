import type { PluginMeta, PluginMarketplaceMeta } from "@/entities/plugin/client";

export interface PluginGroup {
  slug: string;
  label: string;
  count: number;
  plugins: PluginMeta[];
}

/**
 * 필터된 평면 plugin 리스트를 marketplace 별 그룹으로 변환.
 * - 그룹 정렬: 전체 count desc (마켓플레이스 규모 큰 순). 동률은 slug asc.
 * - 빈 그룹(필터로 0개)은 제외.
 * - 그룹 내 plugin 은 입력 순서 보존(호출부가 name asc 정렬해 전달).
 */
export function groupPlugins(
  filtered: PluginMeta[],
  marketplaces: Record<string, PluginMarketplaceMeta>,
): PluginGroup[] {
  const buckets = new Map<string, PluginMeta[]>();
  for (const p of filtered) {
    const bucket = buckets.get(p.marketplace);
    if (bucket) bucket.push(p);
    else buckets.set(p.marketplace, [p]);
  }

  const groups: PluginGroup[] = [];
  for (const [slug, plugins] of buckets) {
    const meta = marketplaces[slug];
    groups.push({
      slug,
      label: meta?.label ?? slug,
      count: meta?.count ?? plugins.length,
      plugins,
    });
  }

  groups.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
  return groups;
}
