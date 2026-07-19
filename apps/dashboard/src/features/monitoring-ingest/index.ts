// 관제 vitals ingest 오케스트레이션 — server 전용 진입점.
// 호출: app/api/agent/metrics-ingest (route 는 인증·파싱만, 도메인 로직은 여기).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { logger } from "@/shared/lib/log";
import {
  insertCheckResults,
  insertMetricSamples,
  recordEvent,
  resolveEvent,
  type NewCheckResult,
} from "@/entities/monitoring/server";
import { flattenVitals } from "./lib/flattenVitals";
import { evaluateVitals } from "./lib/evaluateVitals";
import { judgeChecks, type CheckVerdict } from "./lib/judgeChecks";
import { sourceForKind } from "./lib/sourceForKind";
import { judgeSecurity } from "@/features/monitoring-security";
import {
  vitalsPayloadSchema,
  type VitalsPayload,
} from "./model/vitalsSchema";
import {
  checksPayloadSchema,
  type ChecksPayload,
} from "./model/checksSchema";
import {
  securityPayloadSchema,
  type SecurityPayload,
} from "./model/securitySchema";

export { vitalsPayloadSchema, checksPayloadSchema, securityPayloadSchema };
export type { VitalsPayload, ChecksPayload, SecurityPayload };
export type { CheckVerdict };
export { sourceForKind };
export { VITALS_TIERS, type VitalsTier } from "./lib/evaluateVitals";

/** payload.host 가 hosts.name 에 없을 때 — route 가 404 로 매핑. */
export class UnknownHostError extends Error {
  constructor(host: string) {
    super(`unknown host: ${host}`);
    this.name = "UnknownHostError";
  }
}

export async function ingestVitals(
  payload: VitalsPayload,
): Promise<{ inserted: number }> {
  const row = await db
    .select({ id: hosts.id })
    .from(hosts)
    .where(eq(hosts.name, payload.host))
    .limit(1);
  if (row.length === 0) throw new UnknownHostError(payload.host);
  const hostId = row[0].id;

  const collectedAt = payload.collectedAt
    ? new Date(payload.collectedAt)
    : new Date();
  const inserted = await insertMetricSamples(
    flattenVitals(hostId, payload, collectedAt),
  );

  // 임계값 평가·이벤트 기록은 best-effort — 샘플 저장 성공(200)을 뒤집지 않는다.
  try {
    for (const verdict of evaluateVitals(payload)) {
      const dedupKey = `host:${hostId}:${verdict.dedupKeySuffix}`;
      if (verdict.violated) {
        await recordEvent({
          source: "host",
          severity: verdict.severity,
          title: verdict.title,
          detail: verdict.detail,
          dedupKey,
          hostId,
        });
      } else {
        await resolveEvent(dedupKey);
      }
    }
  } catch (err) {
    logger.warn("monitoring-ingest", "event-record-failed", {
      host: payload.host,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { inserted };
}

/**
 * checks payload ingest (Phase 2) — systemd 서비스/타이머·호스트 cron 판정.
 * 판정(judgeChecks)은 순수, 여기서 check_results 저장 + 이벤트 기록/해소.
 */
export async function ingestChecks(
  payload: ChecksPayload,
): Promise<{ inserted: number }> {
  const row = await db
    .select({ id: hosts.id })
    .from(hosts)
    .where(eq(hosts.name, payload.host))
    .limit(1);
  if (row.length === 0) throw new UnknownHostError(payload.host);
  const hostId = row[0].id;

  const checkedAt = payload.collectedAt
    ? new Date(payload.collectedAt)
    : new Date();
  // Phase 2 판정 + Phase 3 보안 판정. security 섹션이 없는 호스트는 보안 verdict 없음
  // (판정 자체를 건너뛴다 — 감시 대상이 아닌 호스트에 unknown 행을 만들지 않기 위해).
  const verdicts: CheckVerdict[] = [
    ...judgeChecks(payload, checkedAt),
    ...(payload.security ? judgeSecurity(payload.security) : []),
  ];

  const inserted = await insertCheckResults(
    verdicts.map(
      (v): NewCheckResult => ({
        kind: v.kind,
        target: v.target,
        status: v.status,
        detail: v.detail,
        hostId,
        checkedAt,
      }),
    ),
  );

  // 이벤트 기록/해소는 best-effort — 결과 저장 성공(200)을 뒤집지 않는다.
  try {
    for (const v of verdicts) {
      const dedupKey = `host:${hostId}:${v.dedupKeySuffix}`;
      if (v.status === "critical" || v.status === "warning") {
        await recordEvent({
          source: sourceForKind(v.kind),
          severity: v.status,
          title: v.title,
          detail: JSON.stringify(v.detail),
          dedupKey,
          hostId,
        });
      } else if (v.status === "ok") {
        await resolveEvent(dedupKey);
      }
      // unknown: no-op — 관찰 불가는 위반도 정상 복귀도 아니다.
    }
  } catch (err) {
    logger.warn("monitoring-ingest", "check-event-record-failed", {
      host: payload.host,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { inserted };
}
