// monitoring_events 기록·해소·조회.
//
// dedup 정책 (이슈 #323 §K): 동일 dedupKey 의 open(resolvedAt null) 이벤트가
// 있으면 재기록하지 않는다. severity 가 달라지면(에스컬레이션/완화) 기존 row 를
// 갱신한다. 정상 복귀는 resolveEvent 가 resolvedAt 을 채운다 (플래핑 감지 기반).
//
// 동시성: monitoring_events_open_dedup_uq (dedup_key, resolved_at is null 부분
// unique index) 가 중복 open 생성을 DB 레벨에서 차단 — insert 를 먼저 시도하고
// unique 충돌(23505)이면 "이미 open 존재" 경로로 전환한다 (SELECT-then-INSERT
// race 방어, Codex 리뷰 P1).
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { monitoringEvents } from "@/shared/lib/db/schema";
import {
  type MonitoringEventInput,
  type MonitoringEventRow,
  type OpenEventCounts,
} from "../model/types";

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err == null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  // drizzle 이 driver 에러를 wrapping 하는 경우 (cause 체인)
  return isUniqueViolation((err as { cause?: unknown }).cause);
}

export async function recordEvent(input: MonitoringEventInput): Promise<void> {
  try {
    await db.insert(monitoringEvents).values({
      source: input.source,
      severity: input.severity,
      title: input.title,
      detail: input.detail ?? null,
      dedupKey: input.dedupKey,
      hostId: input.hostId ?? null,
    });
    return;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  // 이미 open 존재 — severity 가 달라졌을 때만 갱신 (같으면 no-op = 중복 억제).
  await db
    .update(monitoringEvents)
    .set({
      severity: input.severity,
      title: input.title,
      detail: input.detail ?? null,
    })
    .where(
      and(
        eq(monitoringEvents.dedupKey, input.dedupKey),
        isNull(monitoringEvents.resolvedAt),
        ne(monitoringEvents.severity, input.severity),
      ),
    );
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
