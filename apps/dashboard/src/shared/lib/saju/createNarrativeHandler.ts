// Saju narrative API route 팩토리 — lifetime/yearly/monthly/daily 4개 route 가 공유하는
// auth → school 검증 → rate limit → build+narrative → 에러 분기 시퀀스를 단일 factory 로 묶는다.
//
// createCronHandler (shared/lib/cron) 의 saju-narrative 판 미러.
//
// variation point 3개:
//   1. parseParams  — date-specific 쿼리 파싱 (lifetime: 없음, yearly: year, monthly: year+month, daily: forDate)
//   2. buildAndNarrate — getOrBuildXxx + getOrBuildXxxNarrative 쌍 호출
//   3. buildErrorClass — 도메인별 BuildError (instanceof 디스패치용)
import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { checkRateLimit, type RateLimitKeyPrefix } from "@/shared/lib/llm/rateLimit";
import {
  SAJU_MODEL_REGISTRY,
  parseSajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";
import { ProfileNotFoundError } from "@/shared/lib/saju/resolveBirthInput";

const SCHOOL_FRAME_KEY = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
} as const;

type SchoolParam = keyof typeof SCHOOL_FRAME_KEY;
export type FrameKey = (typeof SCHOOL_FRAME_KEY)[SchoolParam];

function isSchoolParam(value: string | null): value is SchoolParam {
  return value !== null && value in SCHOOL_FRAME_KEY;
}

export type NarrativeSchool = SchoolParam;

type ParseResult<P> =
  | { ok: true; params: P }
  | { ok: false; code: string; status: number };

export interface NarrativeHandlerConfig<P> {
  name: string;
  keyPrefix: RateLimitKeyPrefix;
  parseParams: (searchParams: URLSearchParams) => ParseResult<P>;
  buildAndNarrate: (ctx: {
    profileId: string;
    userId: string;
    school: NarrativeSchool;
    frameKey: FrameKey;
    params: P;
    modelId: string;
  }) => Promise<unknown>;
  buildErrorClass: new (...args: never[]) => Error;
}

export function createNarrativeHandler<P>(
  config: NarrativeHandlerConfig<P>,
) {
  return async function GET(
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

    const parsed = config.parseParams(searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.code }, { status: parsed.status });
    }

    const rate = await checkRateLimit(session.user.id, config.keyPrefix);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs },
        { status: 429 },
      );
    }

    try {
      const modelKey = parseSajuModelKey(searchParams.get("model"));
      const modelId = SAJU_MODEL_REGISTRY[modelKey].id;
      const result = await config.buildAndNarrate({
        profileId,
        userId: session.user.id,
        school: schoolParam,
        frameKey: SCHOOL_FRAME_KEY[schoolParam],
        params: parsed.params,
        modelId,
      });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        return NextResponse.json(
          { error: "PROFILE_NOT_FOUND" },
          { status: 404 },
        );
      }
      if (err instanceof config.buildErrorClass) {
        return NextResponse.json({ error: err.message }, { status: 422 });
      }
      console.error(`[saju/${config.name}/narrative] LLM error:`, err);
      return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
    }
  };
}
