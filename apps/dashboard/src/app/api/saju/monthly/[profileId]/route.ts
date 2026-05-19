// GET /api/saju/monthly/[profileId]?year=YYYY&month=MM
//
// - auth 필수 (session.user.id 없으면 401)
// - year 쿼리 누락 시 KST 현재 연도, 정수 1900..2100 외 → 400 INVALID_YEAR
// - month 쿼리 누락 시 KST 현재 월, 정수 1..12 외 → 400 INVALID_MONTH
// - getOrBuildMonthly → 캐시 hit 시 즉시 반환, miss 시 build + insert
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * MonthlyBuildError    → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외                  → 500 + console.error (generic INTERNAL_ERROR)
//
// v0.2 yearly/route.ts 와의 차이: month 쿼리 파싱·검증 단계 추가.
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  getOrBuildMonthly,
  MonthlyBuildError,
  ProfileNotFoundError,
  currentKstMonth,
  currentKstYear,
} from "@/features/saju-monthly-tri/api/monthly-server";

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
  const searchParams = new URL(req.url).searchParams;

  // year 쿼리 — 누락 시 KST 현재 연도
  const yearParam = searchParams.get("year");
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

  // month 쿼리 — 누락 시 KST 현재 월
  const monthParam = searchParams.get("month");
  let targetMonth: number;
  if (monthParam === null) {
    targetMonth = currentKstMonth();
  } else {
    const parsed = Number(monthParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
      return NextResponse.json({ error: "INVALID_MONTH" }, { status: 400 });
    }
    targetMonth = parsed;
  }

  try {
    const result = await getOrBuildMonthly(
      profileId,
      session.user.id,
      targetYear,
      targetMonth,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json(
        { error: "PROFILE_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (err instanceof MonthlyBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[saju/monthly] internal error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
