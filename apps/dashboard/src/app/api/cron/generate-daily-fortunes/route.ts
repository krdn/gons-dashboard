// 매일 자정 KST — 활성 프로필 전원의 오늘 일진을 일괄 생성.
//
// CRITICAL §3 #10: KST 자정 정확 트리거 — 호출자(node-cron 컨테이너)가
//   timezone: 'Asia/Seoul', cron expression: '1 0 * * *'.
//
// 셰이프: createCronHandler factory 위임. caller 책임: 차트 INNER JOIN select + per-차트 일진 생성.
//   concurrency: 2 (LLM rate limit / 비용 burst 회피 — 옛 무제한 allSettled 대비 안정성 개선).
//   activeProfile × 차트 INNER JOIN — 차트 없는 프로필은 일진 생성 대상이 아님 (skip).
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles, sajuCharts } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { generateDailyFortune } from "@/features/saju-reading/api/generateDailyFortune";

export const dynamic = "force-dynamic";

/** KST(UTC+9) 기준 오늘 날짜를 'YYYY-MM-DD' 로 반환. */
function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export const POST = createCronHandler({
  name: "generate-daily-fortunes",
  targetSelect: async () =>
    db
      .select({ chart: sajuCharts })
      .from(fortuneProfiles)
      .innerJoin(sajuCharts, eq(sajuCharts.profileId, fortuneProfiles.id))
      .where(eq(fortuneProfiles.isActive, true)),
  getId: (r) => r.chart.id,
  getLabel: (r) => r.chart.profileId,
  perTarget: async (r) => {
    const result = await generateDailyFortune({ chartRow: r.chart, forDate: kstTodayDate() });
    return { cached: result.cached };
  },
  concurrency: 2,
  extra: async () => ({ forDate: kstTodayDate() }),
});
