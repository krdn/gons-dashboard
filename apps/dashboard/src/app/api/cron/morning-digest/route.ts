// 아침 8시 KST 디지스트 알림 발송.
//
// CRITICAL §3 #10: KST 8시 정확 트리거 — 호출자(node-cron 컨테이너) timezone 'Asia/Seoul', expr '0 8 * * *'.
// CRITICAL §3 #11: TOP 5 reply_needed SQL — getReplyNeeded(userId, 5) 재사용.
// 셰이프: createCronHandler factory 위임. caller 책임: 활성 대상 select + per-user push work.
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users, pushSubscriptions } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { getReplyNeeded } from "@/entities/email";
import { sendPush } from "@/shared/lib/push";

export const dynamic = "force-dynamic";

export const POST = createCronHandler({
  name: "morning-digest",
  targetSelect: async () =>
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.oauthState, "active")),
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u) => {
    const items = await getReplyNeeded(u.id, { limit: 5 });
    if (items.length === 0) {
      // 빈 디지스트는 알림 보내지 않음 — 매일 빈 알림은 노이즈.
      return { itemCount: 0, sent: 0, expired: 0, errors: 0 };
    }

    const subs = await db
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, u.id));

    const title = `오늘 답장 필요 ${items.length}건`;
    const top = items[0];
    const body =
      items.length === 1
        ? `${top.fromName ?? top.fromEmail} — ${top.subject ?? "(제목 없음)"}`
        : `${top.fromName ?? top.fromEmail} 외 ${items.length - 1}건`;

    let sent = 0;
    let expired = 0;
    let errors = 0;
    const expiredEndpoints: string[] = [];

    for (const sub of subs) {
      const result = await sendPush(sub, { title, body, url: "/", tag: "morning-digest" });
      if (result.kind === "sent") sent += 1;
      else if (result.kind === "expired") {
        expired += 1;
        expiredEndpoints.push(result.endpoint);
      } else if (result.kind === "error") errors += 1;
    }

    // 만료된 endpoint 제거 — 다음 발송 시 재시도 안 함.
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
      }
    }

    return { itemCount: items.length, sent, expired, errors };
  },
  concurrency: 10,
});
