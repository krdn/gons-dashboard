import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { sajuDailyFortunes } from "@/shared/lib/db/schema";
import type { SajuDailyFortuneRow } from "../model/types";

/** 단일 chart × 단일 날짜의 일진 row. 없으면 null. */
export async function getTodayDailyFortune(
  chartId: string,
  forDate: string,
): Promise<SajuDailyFortuneRow | null> {
  const [row] = await db
    .select()
    .from(sajuDailyFortunes)
    .where(
      and(
        eq(sajuDailyFortunes.chartId, chartId),
        eq(sajuDailyFortunes.forDate, forDate),
      ),
    )
    .limit(1);
  return row ?? null;
}
