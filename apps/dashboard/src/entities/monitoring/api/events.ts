// monitoring_events 기록·해소·조회.
//
// dedup 정책 (이슈 #323 §K): 동일 dedupKey 의 open(resolvedAt null) 이벤트가
// 있으면 재기록하지 않는다. severity 가 달라지면(에스컬레이션/완화) 기존 row 를
// 갱신한다. 정상 복귀는 resolveEvent 가 resolvedAt 을 채운다 (플래핑 감지 기반).
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { monitoringEvents } from "@/shared/lib/db/schema";
import {
  type MonitoringEventInput,
  type MonitoringEventRow,
  type OpenEventCounts,
} from "../model/types";

export async function recordEvent(input: MonitoringEventInput): Promise<void> {
  const open = await db
    .select({
      id: monitoringEvents.id,
      severity: monitoringEvents.severity,
    })
    .from(monitoringEvents)
    .where(
      and(
        eq(monitoringEvents.dedupKey, input.dedupKey),
        isNull(monitoringEvents.resolvedAt),
      ),
    )
    .orderBy(desc(monitoringEvents.occurredAt))
    .limit(1);

  if (open.length === 0) {
    await db.insert(monitoringEvents).values({
      source: input.source,
      severity: input.severity,
      title: input.title,
      detail: input.detail ?? null,
      dedupKey: input.dedupKey,
      hostId: input.hostId ?? null,
    });
    return;
  }

  if (open[0].severity === input.severity) return; // 중복 억제

  await db
    .update(monitoringEvents)
    .set({
      severity: input.severity,
      title: input.title,
      detail: input.detail ?? null,
    })
    .where(eq(monitoringEvents.id, open[0].id));
}

export async function resolveEvent(dedupKey: string): Promise<void> {
  await db
    .update(monitoringEvents)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(monitoringEvents.dedupKey, dedupKey),
        isNull(monitoringEvents.resolvedAt),
      ),
    );
}

export async function listRecentEvents(limit = 50): Promise<MonitoringEventRow[]> {
  return db
    .select()
    .from(monitoringEvents)
    .orderBy(desc(monitoringEvents.occurredAt))
    .limit(limit);
}

export async function countOpenEvents(): Promise<OpenEventCounts> {
  const rows = await db
    .select({
      severity: monitoringEvents.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(monitoringEvents)
    .where(isNull(monitoringEvents.resolvedAt))
    .groupBy(monitoringEvents.severity);

  const bySeverity = new Map(rows.map((r) => [r.severity, r.count]));
  return {
    critical: bySeverity.get("critical") ?? 0,
    warning: bySeverity.get("warning") ?? 0,
  };
}
