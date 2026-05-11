// Cron 매시간 트리거 — 모든 활성 사용자의 inbox sync.
//
// 분기 정책:
//  - syncInbox 분기 3개 (정상 / 404 / invalid_grant) 처리
//  - Bearer 인증 — 누락·잘못 → 401
//
// 호출자: 별도 cron 컨테이너. curl로 이 엔드포인트 호출.
import { NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { syncInbox } from "@/features/gmail-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyCronBearer(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 활성 사용자만 — reauth_required 상태는 polling 안 함.
  const activeUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.oauthState, "active"));

  const results: Array<{
    userId: string;
    email: string;
    kind: string;
    classifiedCount?: number;
    skippedCount?: number;
    error?: string;
  }> = [];

  for (const user of activeUsers) {
    try {
      const result = await syncInbox(user.id);
      results.push({
        userId: user.id,
        email: user.email,
        kind: result.kind,
        classifiedCount: result.classifiedCount,
        skippedCount: result.skippedCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error("[poll-gmail] sync 실패:", user.email, message);
      results.push({
        userId: user.id,
        email: user.email,
        kind: "error",
        error: message,
      });
    }
  }

  // reauth_required 사용자는 별도 카운트만.
  const reauthCount = await db
    .select({ count: users.id })
    .from(users)
    .where(and(ne(users.oauthState, "active")))
    .then((r) => r.length);

  return NextResponse.json({
    runAt: new Date().toISOString(),
    activeUsers: activeUsers.length,
    reauthRequired: reauthCount,
    results,
  });
}
