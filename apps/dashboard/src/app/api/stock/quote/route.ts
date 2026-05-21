import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { fetchYahooQuotes } from "@gons/stock-analysis";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 20;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [] });
  }
  try {
    const quotes = await fetchYahooQuotes(symbols);
    return NextResponse.json({ quotes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "Yahoo quote failed", detail: msg },
      { status: 502 },
    );
  }
}
