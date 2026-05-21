import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { fetchYahooSearch } from "@gons/stock-analysis";
import { searchStockMaster } from "@/entities/stock-master/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  // 한글 또는 6자리 숫자코드 → KRX 마스터 DB 검색 (Yahoo 한글 우회).
  const isHangul = /[가-힯]/.test(q);
  const isKrxCode = /^\d{6}$/.test(q);
  if (isHangul || isKrxCode) {
    const results = await searchStockMaster(q);
    return NextResponse.json({ results });
  }

  // 영문/티커 → 기존 Yahoo 경로 (US/Crypto/Commodity).
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
