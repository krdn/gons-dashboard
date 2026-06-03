// 주간 autopilot 사이클 결과를 DB 에 영속화하는 저장 전용 엔드포인트.
// 호출자: 주간 /schedule 원격 에이전트 (cycle.workflow.js 반환값을 그대로 POST).
// 인증: verifyCronBearer (실패 시 401). 검증: Zod (실패 시 400).
import { NextResponse } from "next/server";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { recordCycle, AutopilotCycleInput } from "@/entities/autopilot-cycle/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyCronBearer(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = AutopilotCycleInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad-request", issues: parsed.error.issues }, { status: 400 });
  }

  await recordCycle(parsed.data);
  return NextResponse.json({ status: "ok", id: parsed.data.id });
}
