// GET /api/saju/monthly/[profileId]/narrative?school=ko|cn-ziping|cn-mangpai|jp&year=YYYY&month=MM
//
// - auth 필수 (session.user.id 없으면 401)
// - school 쿼리 필수 (4가지 학파 외 값은 400 INVALID_SCHOOL)
// - year 쿼리 누락 시 KST 현재 연도, 정수 1900..2100 외 → 400 INVALID_YEAR
// - month 쿼리 누락 시 KST 현재 월, 정수 1..12 외 → 400 INVALID_MONTH
// - rate limit (5/min/user, keyPrefix='monthly') → 초과 시 429 + retryAfterMs
// - getOrBuildMonthly → frames[school] → getOrBuildMonthlyNarrative 체인
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * MonthlyBuildError    → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외 (LLM/JSON/zod) → 500 + console.error
//
// v0.2 yearly/narrative/route.ts 와의 차이: month 쿼리 파싱·검증 + keyPrefix='monthly'.
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  getOrBuildMonthly,
  MonthlyBuildError,
  ProfileNotFoundError,
  currentKstMonth,
  currentKstYear,
} from "@/features/saju-monthly-tri/api/monthly-server";
import {
  getOrBuildMonthlyNarrative,
  type NarrativeSchool,
} from "@/features/saju-monthly-tri/api/narrative-server";
import { checkRateLimit } from "@/shared/lib/llm/rateLimit";
import {
  SAJU_MODEL_REGISTRY,
  parseSajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";

// URL 쿼리 학파 → TriNationMonthly.frames 키 매핑.
const SCHOOL_FRAME_KEY = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
} as const;

type SchoolParam = keyof typeof SCHOOL_FRAME_KEY;

function isSchoolParam(value: string | null): value is SchoolParam {
  return value !== null && value in SCHOOL_FRAME_KEY;
}

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

  const schoolParam = searchParams.get("school");
  if (!isSchoolParam(schoolParam)) {
    return NextResponse.json({ error: "INVALID_SCHOOL" }, { status: 400 });
  }

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

  // rate limit — keyPrefix='monthly' 로 lifetime/yearly 카운터와 분리.
  // 호출 자체가 카운트되므로 캐시 hit/miss 무관.
  const rate = await checkRateLimit(session.user.id, "monthly");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const monthly = await getOrBuildMonthly(
      profileId,
      session.user.id,
      targetYear,
      targetMonth,
    );
    const frame = monthly.triNation.frames[SCHOOL_FRAME_KEY[schoolParam]];
    const school: NarrativeSchool = schoolParam;
    const modelKey = parseSajuModelKey(searchParams.get("model"));
    const modelId = SAJU_MODEL_REGISTRY[modelKey].id;
    const result = await getOrBuildMonthlyNarrative(
      profileId,
      school,
      targetYear,
      targetMonth,
      frame,
      modelId,
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
    // LLM/JSON/zod 실패 — log only, 사용자 친화 메시지 없음 (D3 정책).
    console.error("[saju/monthly/narrative] LLM error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
