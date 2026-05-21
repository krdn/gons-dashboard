import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { fetchYahooSearch } from "@gons/stock-analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  if (q.trim().length < 1) {
    return NextResponse.json({ results: [] });
  }
  try {
    const results = await fetchYahooSearch(q);
    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "Yahoo search failed", detail: msg },
      { status: 502 },
    );
  }
}
