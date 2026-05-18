// GET /api/saju/yearly/[profileId]/narrative?school=ko|cn-ziping|cn-mangpai|jp&year=YYYY
//
// - auth 필수 (session.user.id 없으면 401)
// - school 쿼리 필수 (4가지 학파 외 값은 400 INVALID_SCHOOL)
// - year 쿼리 누락 시 KST 현재 연도, 정수 1900..2100 외 → 400 INVALID_YEAR
// - rate limit (5/min/user, keyPrefix='yearly') → 초과 시 429 + retryAfterMs
// - getOrBuildYearly → frames[school] → getOrBuildYearlyNarrative 체인
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * YearlyBuildError     → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외 (LLM/JSON/zod) → 500 + console.error
//
// v0.1 lifetime/narrative/route.ts 와의 차이:
//  - year 쿼리 파싱·검증 추가
//  - checkRateLimit keyPrefix='yearly' (v0.1 lifetime 카운터와 분리)
//  - getOrBuildYearly + getOrBuildYearlyNarrative 체인
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  getOrBuildYearly,
  YearlyBuildError,
  ProfileNotFoundError,
  currentKstYear,
} from "@/features/saju-yearly-tri/api/yearly-server";
import {
  getOrBuildYearlyNarrative,
  type NarrativeSchool,
} from "@/features/saju-yearly-tri/api/narrative-server";
import { checkRateLimit } from "@/shared/lib/llm/rateLimit";

// URL 쿼리 학파(ko/cn-ziping/cn-mangpai/jp) → TriNationYearly.frames 키 매핑.
// (frames 의 키는 camelCase, 쿼리는 kebab-case 로 가독성 유지)
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

  // rate limit — keyPrefix='yearly' 로 v0.1 lifetime 카운터와 분리.
  // 호출 자체가 카운트되므로 캐시 hit/miss 무관.
  const rate = await checkRateLimit(session.user.id, "yearly");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const yearly = await getOrBuildYearly(profileId, session.user.id, targetYear);
    const frame = yearly.triNation.frames[SCHOOL_FRAME_KEY[schoolParam]];
    const school: NarrativeSchool = schoolParam;
    const result = await getOrBuildYearlyNarrative(
      profileId,
      school,
      targetYear,
      frame,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json(
        { error: "PROFILE_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (err instanceof YearlyBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    // LLM/JSON/zod 실패 — log only, 사용자 친화 메시지 없음 (v0.1 D3 정책).
    console.error("[saju/yearly/narrative] LLM error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
