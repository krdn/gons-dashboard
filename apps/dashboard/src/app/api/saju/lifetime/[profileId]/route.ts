// GET /api/saju/lifetime/[profileId]
//
// - auth 필수 (session.user.id 없으면 401)
// - getOrBuildLifetime 호출 → 캐시 hit 시 즉시 반환, miss 시 build + insert
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * LifetimeBuildError   → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외                  → 500 + console.error (generic INTERNAL_ERROR)
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { logger } from "@/shared/lib/log";
import {
  getOrBuildLifetime,
  LifetimeBuildError,
  ProfileNotFoundError,
} from "@/features/saju-lifetime-tri/api/lifetime-server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId } = await ctx.params;
  try {
    const result = await getOrBuildLifetime(profileId, session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
    }
    if (err instanceof LifetimeBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    logger.error("saju/lifetime", "internal-error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
