// 매일 03:17 KST — 관제 데이터 보존 정책 purge (이슈 #323 §3 저장).
//   metric_samples: 48h (쓰기 빈도 최고 — 자기 참조 관제의 디스크 증가 억제)
//   cron_runs: 30d
//   monitoring_events: resolved 만 90d (open 이벤트는 보존)
//   check_results: 48h (최신 row 가 현재 상태 — 일 1회 kind 도 창 안에 남는다)
//   remediation_attempts: 7d (자동 복구, 5분마다 적재 — 이슈 #352)
// 다운샘플(5분 집계)은 Phase 4.
import { and, isNotNull, lt } from "drizzle-orm";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { db } from "@/shared/lib/db/client";
import {
  checkResults,
  cronRuns,
  metricSamples,
  monitoringEvents,
  remediationAttempts,
} from "@/shared/lib/db/schema";

export const dynamic = "force-dynamic";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const TARGETS = [
  { id: "metric_samples" },
  { id: "cron_runs" },
  { id: "monitoring_events" },
  { id: "check_results" },
  { id: "remediation_attempts" },
] as const;
type PurgeTarget = (typeof TARGETS)[number];

async function purge(target: PurgeTarget): Promise<number> {
  const now = Date.now();
  switch (target.id) {
    case "metric_samples": {
      const res = await db
        .delete(metricSamples)
        .where(lt(metricSamples.collectedAt, new Date(now - 48 * HOUR_MS)));
      return res.count;
    }
    case "cron_runs": {
      const res = await db
        .delete(cronRuns)
        .where(lt(cronRuns.startedAt, new Date(now - 30 * DAY_MS)));
      return res.count;
    }
    case "monitoring_events": {
      const res = await db
        .delete(monitoringEvents)
        .where(
          and(
            isNotNull(monitoringEvents.resolvedAt),
            lt(monitoringEvents.occurredAt, new Date(now - 90 * DAY_MS)),
          ),
        );
      return res.count;
    }
    case "check_results": {
      const res = await db
        .delete(checkResults)
        .where(lt(checkResults.checkedAt, new Date(now - 48 * HOUR_MS)));
      return res.count;
    }
    case "remediation_attempts": {
      const res = await db
        .delete(remediationAttempts)
        .where(lt(remediationAttempts.attemptedAt, new Date(now - 7 * DAY_MS)));
      return res.count;
    }
  }
}

export const POST = createCronHandler({
  name: "monitoring-purge",
  targetSelect: async () => [...TARGETS],
  getId: (t) => t.id,
  perTarget: async (t) => ({ deleted: await purge(t) }),
});
