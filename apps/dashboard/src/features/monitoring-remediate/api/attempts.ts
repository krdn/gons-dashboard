// 자동 복구 시도 기록 + 원자적 실행권 획득 (이슈 #352).
//
// claim 은 recordEvent 의 INSERT-first 패턴을 미러한다. SELECT 로 "실행
// 중인가" 확인 후 INSERT 하면 두 사이클이 같은 틈에 통과한다 — INSERT 를
// 먼저 시도해 DB(remediation_in_flight_uq)가 중재하게 한다.
import "server-only";
import { and, eq, gt, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { remediationAttempts } from "@/shared/lib/db/schema";
import { type AttemptSummary } from "../lib/guards";

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err == null) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((err as { cause?: unknown }).cause);
}

export type ClaimInput = {
  eventId: string;
  dedupKey: string;
  policyId: string;
  action: string;
  dryRun: boolean;
  detail: string;
};

/** 실행권 획득. 다른 사이클이 이미 실행 중이면 null. */
export async function claimAttempt(input: ClaimInput): Promise<string | null> {
  try {
    const [row] = await db
      .insert(remediationAttempts)
      .values({
        eventId: input.eventId ?? null,
        dedupKey: input.dedupKey,
        policyId: input.policyId,
        action: input.action,
        dryRun: input.dryRun,
        outcome: "in_flight",
        detail: input.detail,
      })
      .returning({ id: remediationAttempts.id });
    return row.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function settleAttempt(
  id: string,
  outcome: "executed" | "failed",
  reason?: string,
): Promise<void> {
  await db
    .update(remediationAttempts)
    .set({ outcome, reason: reason ?? null, settledAt: new Date() })
    .where(eq(remediationAttempts.id, id));
}

/** 같은 사유의 skip 을 이 시간 안에는 한 번만 기록한다. 5분 주기 cron 이
 *  같은 판정을 반복해 감사 기록을 도배하는 것을 막는다 — 도배된 보드는
 *  사람이 검토하지 않으므로 기록의 목적 자체가 사라진다. */
const SKIP_DEDUPE_HOURS = 6;

export async function recordSkip(input: {
  eventId: string;
  dedupKey: string;
  policyId: string;
  reason: string;
}): Promise<void> {
  const since = new Date(Date.now() - SKIP_DEDUPE_HOURS * 60 * 60 * 1000);
  const existing = await db
    .select({ id: remediationAttempts.id })
    .from(remediationAttempts)
    .where(
      and(
        eq(remediationAttempts.dedupKey, input.dedupKey),
        eq(remediationAttempts.policyId, input.policyId),
        eq(remediationAttempts.reason, input.reason),
        eq(remediationAttempts.outcome, "skipped"),
        gt(remediationAttempts.attemptedAt, since),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(remediationAttempts).values({
    eventId: input.eventId ?? null,
    dedupKey: input.dedupKey,
    policyId: input.policyId,
    action: "-",
    dryRun: true,
    outcome: "skipped",
    reason: input.reason,
    settledAt: new Date(),
  });
}

export async function loadHistory(
  dedupKeys: string[],
  since: Date,
): Promise<Map<string, AttemptSummary[]>> {
  if (dedupKeys.length === 0) return new Map();
  const rows = await db
    .select({
      dedupKey: remediationAttempts.dedupKey,
      outcome: remediationAttempts.outcome,
      attemptedAt: remediationAttempts.attemptedAt,
    })
    .from(remediationAttempts)
    .where(
      and(
        inArray(remediationAttempts.dedupKey, dedupKeys),
        gte(remediationAttempts.attemptedAt, since),
      ),
    );

  const map = new Map<string, AttemptSummary[]>();
  for (const r of rows) {
    const list = map.get(r.dedupKey) ?? [];
    list.push({ outcome: r.outcome, attemptedAt: r.attemptedAt });
    map.set(r.dedupKey, list);
  }
  return map;
}

/**
 * 고아 in_flight 정리. 프로세스가 조치 도중 죽으면 row 가 남아 해당 대상이
 * 영구히 잠긴다. 사이클 시작 시 호출한다.
 */
export async function reapStaleInFlight(olderThan: Date): Promise<number> {
  const rows = await db
    .update(remediationAttempts)
    .set({
      outcome: "failed",
      reason: "in-flight 고아 정리 (프로세스 중단 추정)",
      settledAt: new Date(),
    })
    .where(
      and(
        eq(remediationAttempts.outcome, "in_flight"),
        lt(remediationAttempts.attemptedAt, olderThan),
      ),
    )
    .returning({ id: remediationAttempts.id });
  return rows.length;
}
