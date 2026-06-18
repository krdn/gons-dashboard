// GET /api/saju/yearly/[profileId]?year=YYYY
//
// - auth 필수 (session.user.id 없으면 401)
// - year 쿼리 누락 시 KST 현재 연도 default
// - year 가 정수 1900..2100 범위 밖이면 400 INVALID_YEAR
// - getOrBuildYearly → 캐시 hit 시 즉시 반환, miss 시 build + insert
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * YearlyBuildError     → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외                  → 500 + console.error (generic INTERNAL_ERROR)
//
// v0.1 lifetime/route.ts 와의 차이: year 쿼리 파싱·검증 단계만 추가.
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { logger } from "@/shared/lib/log";
import {
  getOrBuildYearly,
  YearlyBuildError,
  ProfileNotFoundError,
  currentKstYear,
} from "@/features/saju-yearly-tri/api/yearly-server";

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId } = await ctx.params;

  // year 쿼리 파싱 — 누락 시 KST 현재 연도
  const yearParam = new URL(req.url).searchParams.get("year");
  let targetYear: number;
  if (yearParam === null) {
    targetYear = currentKstYear();
  } else {
    const parsed = Number(yearParam);
    if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
      return NextResponse.json({ error: "INVALID_YEAR" }, { status: 400 });
    }
    targetYear = parsed;
  }

  try {
    const result = await getOrBuildYearly(profileId, session.user.id, targetYear);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
    }
    if (err instanceof YearlyBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    logger.error("saju/yearly", "internal-error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
