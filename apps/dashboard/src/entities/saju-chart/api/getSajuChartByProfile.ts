import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { sajuCharts, sajuReadings } from "@/shared/lib/db/schema";
import type { SajuChartRow, SajuReadingRow } from "../model/types";

export interface SajuChartWithReadings {
  chart: SajuChartRow;
  readings: SajuReadingRow[];
}

export async function getSajuChartByProfile(
  profileId: string,
): Promise<SajuChartWithReadings | null> {
  const [chart] = await db
    .select()
    .from(sajuCharts)
    .where(eq(sajuCharts.profileId, profileId))
    .limit(1);
  if (!chart) return null;
  const readings = await db
    .select()
    .from(sajuReadings)
    .where(eq(sajuReadings.chartId, chart.id));
  return { chart, readings };
}
