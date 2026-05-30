import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { getTimeframeAnalysisById } from "@/entities/stock-timeframe/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const row = await getTimeframeAnalysisById(session.user.id, id);
  if (!row) {
    return NextResponse.json({ error: "분석 이력을 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ result: row.result });
}
