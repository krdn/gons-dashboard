// autopilot deploy-watcher 가 배포 성공/실패/롤백을 관리자에게 web-push 로 알리는 엔드포인트.
//
// 호출자: apps/cron/autopilot/deploy-watcher.js notify() — Bearer 인증 + { title, message } POST.
// 인증: verifyCronBearer (실패 시 401). 인가: env.ADMIN_EMAILS(CSV) 의 user 만 대상.
import { NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users, pushSubscriptions } from "@/shared/lib/db/schema";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { sendPush } from "@/shared/lib/push";
import { env } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyCronBearer(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { title?: unknown }).title !== "string" ||
    typeof (body as { message?: unknown }).message !== "string"
  ) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const { title, message } = body as { title: string; message: string };

  // ADMIN_EMAILS 는 CSV 문자열 — isAdmin.ts 와 동일하게 trim + toLowerCase 정규화.
  const adminEmails = env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  if (adminEmails.length === 0) {
    return NextResponse.json({ status: "no-admin" });
  }

  // 관리자 user id 조회 → 그들의 push 구독 조회.
  // isAdmin.ts 와 동일하게 DB 쪽도 lower() 로 비교 (양쪽 소문자 → 대칭).
  const adminUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(sql`lower(${users.email})`, adminEmails));
  const ids = adminUsers.map((u) => u.id);

  if (ids.length === 0) {
    return NextResponse.json({ status: "no-admin" });
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, ids));

  // web-push 발송 (직렬 — VAPID rate-limit 친화). expired 구독은 정리.
  let sent = 0;
  const expiredEndpoints: string[] = [];
  for (const sub of subs) {
    const result = await sendPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title, body: message, tag: "autopilot" },
    );
    if (result.kind === "sent") {
      sent += 1;
    } else if (result.kind === "expired") {
      expiredEndpoints.push(result.endpoint);
    }
  }

  if (expiredEndpoints.length > 0) {
    await db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.endpoint, expiredEndpoints));
  }

  return NextResponse.json({ status: "ok", sent });
}
