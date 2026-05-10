// 수동 재분류 트리거 — 검증/복구용.
//
// 인증: cron Bearer 재사용 (verifyCronBearer). curl 한 줄 운영 가능.
// 입력: { email: string, hoursBack?: number, force?: boolean }
//   - email: users.email로 조회 (allowlist 강제 X — bearer가 이미 admin grade).
//   - hoursBack: 1~168 (기본 24).
//   - force: true면 important_emails(user×윈도우) 행 사전 삭제 후 재분류.
//
// 응답: ReclassifyRecentResult 직렬화. 중요 outcomes/forcedDeleted 그대로 노출.
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { reclassifyRecent } from "@/features/gmail-sync";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  hoursBack: z.number().int().min(1).max(168).default(24),
  force: z.boolean().default(false),
});

export async function POST(request: Request) {
  if (!verifyCronBearer(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ValidationError", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, hoursBack, force } = parsed.data;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: "user-not-found", email }, { status: 404 });
  }

  const result = await reclassifyRecent({
    userId: user.id,
    hoursBack,
    force,
  });

  return NextResponse.json({ runAt: new Date().toISOString(), ...result });
}
