import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { getLatestRun } from "@/entities/stock-analysis/server";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  symbol: z.string().min(1).max(32),
  persona: z
    .enum(["wallStreet", "krExpert", "value", "growth", "technical"])
    .optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    symbol: searchParams.get("symbol") ?? "",
    persona: searchParams.get("persona") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 쿼리" }, { status: 400 });
  }

  const run = await getLatestRun(
    session.user.id,
    parsed.data.symbol,
    parsed.data.persona ?? null,
  );
  return NextResponse.json({ run });
}
