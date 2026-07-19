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
import { and, desc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
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

// ---------- 알림 sweep (monitoring-notify cron, Phase 2 §K) ----------

/** 미통지 critical open 이벤트 — 발생 알림 대상. */
export async function listUnnotifiedCriticalEvents(
  limit = 20,
): Promise<MonitoringEventRow[]> {
  return db
    .select()
    .from(monitoringEvents)
    .where(
      and(
        eq(monitoringEvents.severity, "critical"),
        isNull(monitoringEvents.resolvedAt),
        isNull(monitoringEvents.notifiedAt),
      ),
    )
    .orderBy(desc(monitoringEvents.occurredAt))
    .limit(limit);
}

/**
 * 발생 알림은 나갔는데 해소 통지가 안 나간 이벤트 — 회복 알림 대상.
 * severity 조건은 걸지 않는다: notified_at 은 critical 통지에만 세팅되므로
 * 그 자체가 "critical 로 통지했던 이력"이다. severity='critical' 을 추가하면
 * critical→warning 완화 후 해소된 이벤트의 회복 알림이 누락된다 (Codex P1).
 */
export async function listUnnotifiedResolvedEvents(
  limit = 20,
): Promise<MonitoringEventRow[]> {
  return db
    .select()
    .from(monitoringEvents)
    .where(
      and(
        isNotNull(monitoringEvents.resolvedAt),
        isNotNull(monitoringEvents.notifiedAt),
        isNull(monitoringEvents.resolvedNotifiedAt),
      ),
    )
    .orderBy(desc(monitoringEvents.occurredAt))
    .limit(limit);
}

/**
 * cooldown 판정 — 같은 dedupKey 로 since 이후 통지된 row 존재 여부.
 * (플래핑: resolve→재발생으로 새 row 가 생겨도 30분 내 재발송 억제.)
 */
export async function hasRecentNotification(
  dedupKey: string,
  since: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: monitoringEvents.id })
    .from(monitoringEvents)
    .where(
      and(
        eq(monitoringEvents.dedupKey, dedupKey),
        gt(monitoringEvents.notifiedAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 발생 통지 원자적 claim — notified_at IS NULL 인 row 만 마킹하고 성공 여부를
 * 반환한다. 동시 sweep 이 같은 이벤트를 읽어도 한쪽만 true 를 받아 발송하므로
 * 이중 발송이 없다 (SELECT→발송→마킹 순서의 race 방어 — Codex P1).
 */
export async function claimEventNotification(id: string): Promise<boolean> {
  const rows = await db
    .update(monitoringEvents)
    .set({ notifiedAt: new Date() })
    .where(
      and(eq(monitoringEvents.id, id), isNull(monitoringEvents.notifiedAt)),
    )
    .returning({ id: monitoringEvents.id });
  return rows.length > 0;
}

/** 해소 통지 원자적 claim — resolved_notified_at IS NULL 인 row 만. */
export async function claimEventResolvedNotification(
  id: string,
): Promise<boolean> {
  const rows = await db
    .update(monitoringEvents)
    .set({ resolvedNotifiedAt: new Date() })
    .where(
      and(
        eq(monitoringEvents.id, id),
        isNull(monitoringEvents.resolvedNotifiedAt),
      ),
    )
    .returning({ id: monitoringEvents.id });
  return rows.length > 0;
}
