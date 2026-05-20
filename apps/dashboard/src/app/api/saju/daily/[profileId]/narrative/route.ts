// GET /api/saju/daily/[profileId]/narrative?school=ko|cn-ziping|cn-mangpai|jp&forDate=YYYY-MM-DD
//
// - auth 필수 (session.user.id 없으면 401)
// - school 쿼리 필수 (4가지 학파 외 값은 400 INVALID_SCHOOL)
// - forDate 쿼리 누락 시 KST 오늘. YYYY-MM-DD 외 → 400 INVALID_DATE
// - rate limit (5/min/user, keyPrefix='daily') → 초과 시 429 + retryAfterMs
// - getOrBuildDaily → frames[school] → getOrBuildDailyNarrative 체인
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * DailyBuildError      → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외 (LLM/JSON/zod) → 500 + console.error
//
// monthly route 와의 차이: year/month → forDate 쿼리, keyPrefix='daily'.
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  getOrBuildDaily,
  DailyBuildError,
  ProfileNotFoundError,
} from "@/features/saju-daily-tri/api/daily-server";
import {
  getOrBuildDailyNarrative,
  type NarrativeSchool,
} from "@/features/saju-daily-tri/api/narrative-server";
import { currentKstDate } from "@/shared/lib/saju/resolveBirthInput";
import { checkRateLimit } from "@/shared/lib/llm/rateLimit";
import {
  SAJU_MODEL_REGISTRY,
  parseSajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";

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

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

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

  const forDateParam = searchParams.get("forDate");
  const forDate = forDateParam ?? currentKstDate();
  if (!isValidDate(forDate)) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  const rate = await checkRateLimit(session.user.id, "daily");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const daily = await getOrBuildDaily(profileId, session.user.id, forDate);
    const frame = daily.triNation.frames[SCHOOL_FRAME_KEY[schoolParam]];
    const school: NarrativeSchool = schoolParam;
    const modelKey = parseSajuModelKey(searchParams.get("model"));
    const modelId = SAJU_MODEL_REGISTRY[modelKey].id;
    const result = await getOrBuildDailyNarrative(
      profileId,
      school,
      forDate,
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
    if (err instanceof DailyBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[saju/daily/narrative] LLM error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
