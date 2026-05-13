import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  fortuneProfiles,
  sajuCharts,
  sajuReadings,
} from "@/shared/lib/db/schema";
import type { SajuChartRow, SajuReadingRow } from "../model/types";

export interface SajuChartWithReadings {
  chart: SajuChartRow;
  readings: SajuReadingRow[];
}

// ownership 가드를 WHERE 절에 함께 — userId 가 일치하지 않으면 0 rows.
// fortuneProfiles JOIN 으로 검증 (saju_charts 에는 userId 컬럼 없음).
export async function getSajuChartByProfile(
  profileId: string,
  userId: string,
): Promise<SajuChartWithReadings | null> {
  const rows = await db
    .select({ chart: sajuCharts })
    .from(sajuCharts)
    .innerJoin(fortuneProfiles, eq(fortuneProfiles.id, sajuCharts.profileId))
    .where(
      and(
        eq(sajuCharts.profileId, profileId),
        eq(fortuneProfiles.userId, userId),
      ),
    )
    .limit(1);
  const chart = rows[0]?.chart;
  if (!chart) return null;
  const readings = await db
    .select()
    .from(sajuReadings)
    .where(eq(sajuReadings.chartId, chart.id));
  return { chart, readings };
}
