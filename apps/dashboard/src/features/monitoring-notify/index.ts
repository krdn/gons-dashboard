// 관제 critical 알림 sweep — server 전용 진입점 (이슈 #323 §K, Phase 1 잔여).
// 호출: app/api/cron/monitoring-notify (매분).
//
// 정책:
//   - 발생: critical open + notified_at null → 텔레그램 + web-push(ADMIN_EMAILS).
//     cooldown 30분 — 같은 dedup_key 로 최근 통지가 있으면 발송 생략(마킹만).
//   - 회복: critical resolved(발생 통지됨) + resolved_notified_at null → 해소 통지.
//   - 마킹은 발송 성공 여부와 무관하게 항상 — 채널 장애 시 재시도 폭주 대신
//     다음 이벤트에 맡긴다 (알림은 best-effort, warning 은 대시보드만).
import "server-only";
import { inArray } from "drizzle-orm";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { sendTelegram } from "@/shared/lib/telegram";
import { sendPushToUser } from "@/shared/lib/push";
import {
  hasRecentNotification,
  listUnnotifiedCriticalEvents,
  listUnnotifiedResolvedEvents,
  markEventNotified,
  markEventResolvedNotified,
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

async function broadcast(title: string, body: string): Promise<void> {
  await sendTelegram(`${title}\n${body}`);
  for (const userId of await adminUserIds()) {
    await sendPushToUser(userId, {
      title,
      body,
      url: "/monitoring",
      tag: "monitoring-critical",
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
    const cooldownSince = new Date(Date.now() - COOLDOWN_MS);
    if (await hasRecentNotification(event.dedupKey, cooldownSince)) {
      suppressed += 1;
    } else {
      await broadcast(`🔴 [관제] ${event.title}`, eventBody(event));
      sent += 1;
    }
    await markEventNotified(event.id);
  }
  return { candidates: events.length, sent, suppressed };
}

export async function notifyResolvedCriticals(): Promise<NotifySweepSummary> {
  const events = await listUnnotifiedResolvedEvents();
  for (const event of events) {
    await broadcast(`✅ [관제] 해소: ${event.title}`, eventBody(event));
    await markEventResolvedNotified(event.id);
  }
  return { candidates: events.length, sent: events.length, suppressed: 0 };
}
