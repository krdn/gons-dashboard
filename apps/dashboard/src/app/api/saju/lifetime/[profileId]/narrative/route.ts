// GET /api/saju/lifetime/[profileId]/narrative?school=ko|cn-ziping|cn-mangpai|jp
//
// - auth 필수 (session.user.id 없으면 401)
// - school 쿼리 필수 (4가지 학파 외 값은 400 INVALID_SCHOOL)
// - rate limit (5/min/user) → 초과 시 429 + retryAfterMs
// - getOrBuildLifetime → frames[school] → getOrBuildNarrative 체인
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * LifetimeBuildError   → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외 (LLM/JSON/zod) → 500 + console.error (D3: log only, generic 메시지)
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  getOrBuildLifetime,
  LifetimeBuildError,
  ProfileNotFoundError,
} from "@/features/saju-lifetime-tri/api/lifetime-server";
import {
  getOrBuildNarrative,
  type NarrativeSchool,
} from "@/features/saju-lifetime-tri/api/narrative-server";
import { checkRateLimit } from "@/shared/lib/llm/rateLimit";
import {
  SAJU_MODEL_REGISTRY,
  parseSajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";

// URL 쿼리 학파(ko/cn-ziping/cn-mangpai/jp) → TriNationLifetime.frames 키 매핑.
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

export async function GET(
  req: Request,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId } = await ctx.params;
  const schoolParam = new URL(req.url).searchParams.get("school");
  if (!isSchoolParam(schoolParam)) {
    return NextResponse.json({ error: "INVALID_SCHOOL" }, { status: 400 });
  }

  // rate limit — Redis INCR 기반. 호출 자체가 카운트되므로 캐시 hit/miss 무관.
  // keyPrefix='lifetime' — v0.2 yearly narrative 와 카운터 분리.
  const rate = await checkRateLimit(session.user.id, "lifetime");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const lifetime = await getOrBuildLifetime(profileId, session.user.id);
    const frame = lifetime.triNation.frames[SCHOOL_FRAME_KEY[schoolParam]];
    const school: NarrativeSchool = schoolParam;
    const modelKey = parseSajuModelKey(new URL(req.url).searchParams.get("model"));
    const modelId = SAJU_MODEL_REGISTRY[modelKey].id;
    const result = await getOrBuildNarrative(profileId, school, frame, modelId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json(
        { error: "PROFILE_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (err instanceof LifetimeBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    // D3: LLM/JSON/zod 실패 — log only, 사용자 친화 메시지 없음.
    console.error("[saju/narrative] LLM error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
