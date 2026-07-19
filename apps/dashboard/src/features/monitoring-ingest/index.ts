// 관제 vitals ingest 오케스트레이션 — server 전용 진입점.
// 호출: app/api/agent/metrics-ingest (route 는 인증·파싱만, 도메인 로직은 여기).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { logger } from "@/shared/lib/log";
import {
  insertMetricSamples,
  recordEvent,
  resolveEvent,
} from "@/entities/monitoring/server";
import { flattenVitals } from "./lib/flattenVitals";
import { evaluateVitals } from "./lib/evaluateVitals";
import {
  vitalsPayloadSchema,
  type VitalsPayload,
} from "./model/vitalsSchema";

export { vitalsPayloadSchema };
export type { VitalsPayload };
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
