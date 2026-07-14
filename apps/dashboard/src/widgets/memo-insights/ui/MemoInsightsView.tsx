"use client";

import Link from "next/link";
import type {
  ActivityHeatmap,
  DailyTrendPoint,
  CategoryDistribution,
  ActionConversion,
  DigestTimelinePoint,
} from "../model/types";
import { ActivityBlock } from "./ActivityBlock";
import { CategoryBlock } from "./CategoryBlock";
import { ConversionBlock } from "./ConversionBlock";

export interface MemoInsightsViewProps {
  heatmap: ActivityHeatmap;
  trend: DailyTrendPoint[];
  category: CategoryDistribution;
  conversion: ActionConversion;
  digestTimeline: DigestTimelinePoint[];
}

export function MemoInsightsView({ heatmap, trend, category, conversion }: MemoInsightsViewProps) {
  // 전체 빈 상태 — 메모 0개면 차트 대신 안내.
  if (heatmap.totalCount === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center">
        <p className="text-[var(--color-text-muted)]">아직 분석할 메모가 없어요.</p>
        <Link href="/memos" className="mt-3 inline-block text-sm text-green-700 hover:underline">
          메모 작성하러 가기 →
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ActivityBlock heatmap={heatmap} trend={trend} />
      <CategoryBlock category={category} />
      <ConversionBlock conversion={conversion} />
    </div>
  );
}
