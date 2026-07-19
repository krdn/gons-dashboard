// 매주 일요일 06:00 KST — KRX 종목 마스터 갱신 cron.
// 공공데이터포털 "주식시세정보" API 페이지네이션 fetch → reconcile (4분기 처리).
// 응답: { ok, fetched, upserted, delisted, migrations, durationMs, errors }
import "server-only";
import { NextResponse } from "next/server";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { recordCronRun } from "@/shared/lib/cron/recordCronRun";
import { syncKrxMaster } from "@/features/krx-master-sync/api/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyCronBearer(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // 비-factory cron 계측 (#323 Phase 1 잔여) — recordCronRun 은 절대 throw 안 함.
  const startedAt = new Date();
  try {
    const result = await syncKrxMaster();
    await recordCronRun({
      job: "krx-master-sync",
      startedAt,
      finishedAt: new Date(),
      status: result.errors.length > 0 ? "partial" : "ok",
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await recordCronRun({
      job: "krx-master-sync",
      startedAt,
      finishedAt: new Date(),
      status: "error",
      total: 1,
      succeeded: 0,
      failed: 1,
    });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
