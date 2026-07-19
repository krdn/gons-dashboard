// 관제 critical 알림 sweep — server 전용 진입점 (이슈 #323 §K, Phase 1 잔여).
// 호출: app/api/cron/monitoring-notify (매분).
//
// 정책:
//   - 발생: critical open + notified_at null → 텔레그램 + web-push(ADMIN_EMAILS).
//     cooldown 30분 — 같은 dedup_key 로 최근 통지가 있으면 발송 생략(마킹만).
//   - 회복: 발생 통지된 이벤트 resolved + resolved_notified_at null → 해소 통지.
//   - 발송 전에 조건부 UPDATE 로 row 를 원자적으로 claim — 동시 sweep 이중
//     발송 방지 (Codex P1). claim 후 발송 실패는 재시도하지 않는다 — 채널
//     장애 시 재시도 폭주 대신 다음 이벤트에 맡긴다 (알림은 best-effort).
import "server-only";
import { inArray } from "drizzle-orm";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { sendTelegram } from "@/shared/lib/telegram";
import { sendPushToUser } from "@/shared/lib/push";
import {
  claimEventNotification,
  claimEventResolvedNotification,
  hasRecentNotification,
  listUnnotifiedCriticalEvents,
  listUnnotifiedResolvedEvents,
  type MonitoringEventRow,
} from "@/entities/monitoring/server";

const COOLDOWN_MS = 30 * 60_000;

export interface NotifySweepSummary {
  candidates: number;
  sent: number;
  suppressed: number;
}

function adminEmails(): string[] {
  return env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

async function adminUserIds(): Promise<string[]> {
  const emails = adminEmails();
  if (emails.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, emails));
  return rows.map((r) => r.id);
}

async function broadcast(
  title: string,
  body: string,
  tag: string,
): Promise<void> {
  await sendTelegram(`${title}\n${body}`);
  for (const userId of await adminUserIds()) {
    await sendPushToUser(userId, {
      title,
      body,
      url: "/monitoring",
      // dedupKey 기반 태그 — 고정 태그면 SW 가 같은 태그 알림을 교체해
      // 한 sweep 의 다중 장애 중 마지막만 남는다 (Codex P2).
      tag,
    });
  }
}

function eventBody(event: MonitoringEventRow): string {
  return [event.detail, `${env.NEXTAUTH_URL}/monitoring`]
    .filter(Boolean)
    .join("\n");
}

export async function notifyOpenCriticals(): Promise<NotifySweepSummary> {
  const events = await listUnnotifiedCriticalEvents();
  let sent = 0;
  let suppressed = 0;
  for (const event of events) {
    // cooldown 판정은 claim 전에 — claim 이 자기 notified_at 을 세팅하므로
    // 이후에 조회하면 자기 자신에 걸려 항상 suppressed 가 된다.
    const cooldownSince = new Date(Date.now() - COOLDOWN_MS);
    const cooled = await hasRecentNotification(event.dedupKey, cooldownSince);
    if (!(await claimEventNotification(event.id))) continue; // 다른 sweep 이 선점
    if (cooled) {
      suppressed += 1;
    } else {
      await broadcast(
        `🔴 [관제] ${event.title}`,
        eventBody(event),
        `monitoring-${event.dedupKey}`,
      );
      sent += 1;
    }
  }
  return { candidates: events.length, sent, suppressed };
}

export async function notifyResolvedCriticals(): Promise<NotifySweepSummary> {
  const events = await listUnnotifiedResolvedEvents();
  let sent = 0;
  for (const event of events) {
    if (!(await claimEventResolvedNotification(event.id))) continue;
    await broadcast(
      `✅ [관제] 해소: ${event.title}`,
      eventBody(event),
      `monitoring-${event.dedupKey}`,
    );
    sent += 1;
  }
  return { candidates: events.length, sent, suppressed: 0 };
}
