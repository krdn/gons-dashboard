// 매일 자정 KST — 활성 프로필 전원의 오늘 일진을 일괄 생성.
//
// CRITICAL §3 #10: KST 자정 정확 트리거 — 호출자(node-cron 컨테이너)가
//   timezone: 'Asia/Seoul', cron expression: '1 0 * * *'.
//   본 라우트 내부에서도 kstTodayDate()로 KST 기준 오늘 날짜를 계산한다.
// 활성 프로필(fortune_profiles.is_active=true) × 차트 INNER JOIN — 차트 없는
//   프로필은 일진 생성 대상이 아님 (skip).
// Promise.allSettled로 병렬 실행 — 한 프로필 실패가 다른 프로필을 막지 않음.
import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles, sajuCharts } from "@/shared/lib/db/schema";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { generateDailyFortune } from "@/features/saju-reading/api/generateDailyFortune";

export const dynamic = "force-dynamic";

/** KST(UTC+9) 기준 오늘 날짜를 'YYYY-MM-DD' 로 반환. */
function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  if (!verifyCronBearer(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = kstTodayDate();

  // 활성 프로필 × 차트 INNER JOIN (차트 없는 프로필은 skip).
  const rows = await db
    .select({ chart: sajuCharts })
    .from(fortuneProfiles)
    .innerJoin(sajuCharts, eq(sajuCharts.profileId, fortuneProfiles.id))
    .where(eq(fortuneProfiles.isActive, true));

  const results = await Promise.allSettled(
    rows.map((r) => generateDailyFortune({ chartRow: r.chart, forDate: today })),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String(r.reason).slice(0, 200));

  return NextResponse.json({
    forDate: today,
    total: rows.length,
    succeeded,
    failed,
    errors,
  });
}
