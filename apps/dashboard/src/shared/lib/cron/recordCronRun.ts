// cron 실행 기록 (cron_runs) — 관제 #323 Phase 1.
//
// 관측은 best-effort: 기록 실패(예: DB 순단)가 cron 응답(envelope 200)을
// 뒤집으면 안 된다. 절대 throw 하지 않는 계약 — 내부에서 swallow + warn 1줄.
// FSD: shared → entities import 금지라 db/schema 를 직접 사용한다.
import "server-only";
import { db } from "@/shared/lib/db/client";
import { cronRuns } from "@/shared/lib/db/schema";
import { logger } from "@/shared/lib/log";

export interface CronRunRecord {
  job: string;
  startedAt: Date;
  finishedAt: Date;
  status: "ok" | "partial" | "error";
  total: number;
  succeeded: number;
  failed: number;
}

export async function recordCronRun(record: CronRunRecord): Promise<void> {
  try {
    await db.insert(cronRuns).values({
      job: record.job,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      durationMs: record.finishedAt.getTime() - record.startedAt.getTime(),
      status: record.status,
      total: record.total,
      succeeded: record.succeeded,
      failed: record.failed,
    });
  } catch (err) {
    logger.warn("cron-runs", "record-failed", {
      job: record.job,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
