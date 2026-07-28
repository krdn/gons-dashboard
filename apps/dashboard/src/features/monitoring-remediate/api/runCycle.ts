// 자동 복구 사이클 (이슈 #352).
//
// 순서: 고아 정리 → open 이벤트 조회 → 실측 수집 → 조치 선택 → claim →
// 실행 → settle. 실행 여부는 AUTO_REMEDIATE_ENABLED 가 결정하고, 기본은
// dry-run 이다.
import "server-only";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts, monitoringEvents } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";
import { recordEvent } from "@/entities/monitoring/server";
import { selectActions } from "../lib/selectActions";
import {
  RESTART_EXCLUDED,
  type LiveFacts,
  type OpenEventView,
  type RemediationAction,
} from "../config/policies";
import { claimAttempt, loadHistory, recordSkip, reapStaleInFlight, settleAttempt } from "./attempts";
import { executeAction } from "./executeAction";

/** 조치가 이보다 오래 in-flight 면 프로세스가 죽은 것으로 본다. */
const STALE_IN_FLIGHT_MINUTES = 30;
/** 이력 조회 창 — 쿨다운 최대값(24h)보다 넉넉하게. */
const HISTORY_WINDOW_HOURS = 72;

export type CycleSummary = {
  planned: number;
  executed: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

export async function runRemediationCycle(now: Date): Promise<CycleSummary> {
  const dryRun = !env.AUTO_REMEDIATE_ENABLED;

  await reapStaleInFlight(new Date(now.getTime() - STALE_IN_FLIGHT_MINUTES * 60_000));

  const openRows = await db
    .select()
    .from(monitoringEvents)
    .where(isNull(monitoringEvents.resolvedAt));

  const events: OpenEventView[] = openRows.map((r) => ({
    id: r.id,
    dedupKey: r.dedupKey,
    severity: r.severity,
    source: r.source,
    title: r.title,
    detail: r.detail,
    occurredAt: r.occurredAt,
    hostId: r.hostId,
  }));

  const history = await loadHistory(
    events.map((e) => e.dedupKey),
    new Date(now.getTime() - HISTORY_WINDOW_HOURS * 3600_000),
  );

  const facts: LiveFacts = {
    hostAvailableMemBytes: await readHostAvailableMemBytes(),
    containerExcluded: (name) => RESTART_EXCLUDED.some((x) => name.includes(x)),
  };

  const { actions, skips } = selectActions(events, history, facts, now);

  for (const s of skips) {
    await recordSkip({
      eventId: s.event.id,
      dedupKey: s.event.dedupKey,
      policyId: s.policyId,
      reason: s.reason,
    });
  }

  let executed = 0;
  let failed = 0;
  for (const plan of actions) {
    const attemptId = await claimAttempt({
      eventId: plan.event.id,
      dedupKey: plan.event.dedupKey,
      policyId: plan.policyId,
      action: plan.action.kind,
      dryRun,
      detail: JSON.stringify(plan.action),
    });
    // null = 다른 사이클이 실행 중. 이번엔 건너뛴다.
    if (attemptId == null) continue;

    if (dryRun) {
      await settleAttempt(attemptId, "executed", "dry-run — 실제 조치 없음");
      executed += 1;
      continue;
    }

    const hostContext = await readHostContext(plan.action.hostId);
    if (hostContext == null) {
      await settleAttempt(attemptId, "failed", "host context 조회 실패");
      failed += 1;
      continue;
    }

    try {
      const r = await executeAction(plan.action, hostContext);
      if (r.ok) {
        await settleAttempt(attemptId, "executed");
        executed += 1;
        await notifyIfPermanenceNeeded(plan.action);
      } else {
        await settleAttempt(attemptId, "failed", r.message);
        failed += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 500) : "unknown";
      logger.error("monitoring-remediate", "action-failed", {
        policyId: plan.policyId,
        action: plan.action,
        message: msg,
      });
      await settleAttempt(attemptId, "failed", msg);
      failed += 1;
    }
  }

  return { planned: actions.length, executed, skipped: skips.length, failed, dryRun };
}

/**
 * Redis CONFIG SET 은 재시작 시 원복된다. compose 파일은 호스트에 있어
 * 컨테이너에서 고칠 수 없으므로, 사람이 마무리하도록 이벤트를 남긴다 —
 * 자동 조치가 근본 원인을 조용히 덮지 않게 하는 장치다.
 */
async function notifyIfPermanenceNeeded(action: RemediationAction): Promise<void> {
  if (action.kind !== "raise-redis-maxmemory") return;
  await recordEvent({
    source: "host",
    severity: "warning",
    title: `Redis ${action.target} maxmemory 상향의 영구화 필요 (compose 수정)`,
    detail: JSON.stringify({ action }),
    dedupKey: `remediate:permanence:redis:${action.target}`,
  });
}

async function readHostContext(hostId: string): Promise<string | null> {
  const [row] = await db
    .select({ ctx: hosts.dockerContext })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  return row?.ctx ?? null;
}

/**
 * 호스트 여유 메모리 실측.
 *
 * Phase 1 은 null 을 반환한다 — 현재 metric_samples 는 mem.used_pct(비율)만
 * 수집하고 총 메모리 바이트를 싣지 않아, 여유 바이트를 정확히 계산할 수 없다.
 * 비율에서 역산하면 추정값이 되는데, 추정으로 메모리 상한을 올리면 호스트가
 * OOM 에 빠진다. null 이면 redis-maxmemory 정책이 "여유 불명" 으로 skip 하므로
 * 안전한 기본값이다.
 *
 * Phase 2 에서 에이전트가 mem.total_bytes 를 함께 싣도록 확장한 뒤 여기서
 * (total - used) 를 계산한다.
 */
async function readHostAvailableMemBytes(): Promise<number | null> {
  return null;
}
