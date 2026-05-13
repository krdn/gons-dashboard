import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  fortuneProfiles,
  sajuCharts,
  sajuDailyFortunes,
} from "@/shared/lib/db/schema";
import type { SajuDailyFortuneRow } from "../model/types";

/**
 * userId 소유의 모든 활성 프로필 × 오늘 일진을 한 번에 페치.
 * 홈 위젯의 select 가 선택된 프로필의 일진을 즉시 표시할 수 있도록.
 * ownership: fortuneProfiles INNER JOIN where userId=?.
 */
export async function getTodayDailyFortunesForUser(
  userId: string,
  forDate: string,
): Promise<Map<string, SajuDailyFortuneRow>> {
  const rows = await db
    .select({
      profileId: fortuneProfiles.id,
      fortune: sajuDailyFortunes,
    })
    .from(sajuDailyFortunes)
    .innerJoin(sajuCharts, eq(sajuCharts.id, sajuDailyFortunes.chartId))
    .innerJoin(fortuneProfiles, eq(fortuneProfiles.id, sajuCharts.profileId))
    .where(
      and(
        eq(fortuneProfiles.userId, userId),
        eq(sajuDailyFortunes.forDate, forDate),
      ),
    );

  const map = new Map<string, SajuDailyFortuneRow>();
  for (const r of rows) map.set(r.profileId, r.fortune);
  return map;
}
