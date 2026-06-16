// 15분마다 트리거 — 설정 digestHourKst 도달 + 오늘 미발송 사용자만 발송.
//
// isDigestDue로 판정 후, 발송 시 email_settings.lastDigestSentDate=오늘(KST).
// 멱등: 같은 날 재실행은 lastDigestSentDate 비교로 skip.
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users, pushSubscriptions, emailSettings } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { getReplyNeeded } from "@/entities/email";
import { getEmailSettings, isDigestDue } from "@/entities/email-settings";
import { sendPush } from "@/shared/lib/push";

export const dynamic = "force-dynamic";

interface DigestPayload {
  kind: string;
  itemCount?: number;
  sent?: number;
  expired?: number;
  errors?: number;
}

// 현재 KST 시각(hour 0-23)과 날짜('YYYY-MM-DD').
function nowKst(): { hour: number; date: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hourRaw = get("hour");
  const hour = hourRaw === "24" ? 0 : Number(hourRaw);
  return { hour, date };
}

export const POST = createCronHandler({
  name: "morning-digest",
  targetSelect: async () =>
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.oauthState, "active")),
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u): Promise<DigestPayload> => {
    const settings = await getEmailSettings(u.id);
    const { hour, date } = nowKst();

    const [row] = await db
      .select({ lastDigestSentDate: emailSettings.lastDigestSentDate })
      .from(emailSettings)
      .where(eq(emailSettings.userId, u.id))
      .limit(1);
    const lastSentDate = row?.lastDigestSentDate ?? null;

    if (
      !isDigestDue({
        enabled: settings.digestEnabled,
        nowKstHour: hour,
        digestHourKst: settings.digestHourKst,
        todayKstDate: date,
        lastSentDate,
      })
    ) {
      return { kind: "skipped-not-due" };
    }

    const items = await getReplyNeeded(u.id, {
      limit: 5, // 다이제스트는 5건 고정.
      windowDays: settings.windowDays,
      severityThreshold: settings.replySeverityThreshold,
    });
    if (items.length === 0) {
      // 빈 디지스트는 알림 보내지 않음 — 매일 빈 알림은 노이즈.
      // 단 발송 기록은 남겨 하루 종일 재평가하지 않음.
      await markDigestSent(u.id, date);
      return { kind: "ok", itemCount: 0, sent: 0, expired: 0, errors: 0 };
    }

    const subs = await db
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, u.id));

    const title = `답장 필요 ${items.length}건`;
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
      const result = await sendPush(sub, {
        title,
        body,
        url: "/",
        tag: "morning-digest",
      });
      if (result.kind === "sent") sent += 1;
      else if (result.kind === "expired") {
        expired += 1;
        expiredEndpoints.push(result.endpoint);
      } else if (result.kind === "error") errors += 1;
    }

    // 만료된 endpoint 제거 — 다음 발송 시 재시도 안 함.
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, endpoint));
      }
    }

    await markDigestSent(u.id, date);
    return { kind: "ok", itemCount: items.length, sent, expired, errors };
  },
  concurrency: 10,
});

// 발송 기록 — email_settings row 없으면 생성(default + lastDigestSentDate).
async function markDigestSent(userId: string, dateKst: string): Promise<void> {
  await db
    .insert(emailSettings)
    .values({ userId, lastDigestSentDate: dateKst })
    .onConflictDoUpdate({
      target: emailSettings.userId,
      set: { lastDigestSentDate: dateKst, updatedAt: new Date() },
    });
}
