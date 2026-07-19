// cron_runs 보드 조회 — job별 최신 1건 + 24h 집계.
import { gte, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { cronRuns } from "@/shared/lib/db/schema";
import { type CronRunBoardRow } from "../model/types";

export async function listCronRunBoard(): Promise<CronRunBoardRow[]> {
  // job별 최신 1건 — 30d 보존 × collect-docker-stats(매분) 는 4만+ row 라
  // 전체 로드 대신 DISTINCT ON 사용 (cron_runs_job_time_idx 활용).
  // 주의: raw execute 는 drizzle 타입 매핑을 거치지 않아 timestamptz 가
  // 문자열로 올 수 있다 — new Date() 로 정규화.
  const latest = await db.execute<{
    job: string;
    started_at: Date | string;
    duration_ms: number;
    status: string;
  }>(sql`
    SELECT DISTINCT ON (job) job, started_at, duration_ms, status
    FROM cron_runs
    ORDER BY job, started_at DESC
  `);

  const since24h = new Date(Date.now() - 24 * 3_600_000);
  const agg = await db
    .select({
      job: cronRuns.job,
      runs: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${cronRuns.status} <> 'ok')::int`,
    })
    .from(cronRuns)
    .where(gte(cronRuns.startedAt, since24h))
    .groupBy(cronRuns.job);
  const aggByJob = new Map(agg.map((a) => [a.job, a]));

  return [...latest]
    .map((row) => ({
      job: row.job,
      lastRunAt: new Date(row.started_at),
      lastStatus: row.status,
      lastDurationMs: row.duration_ms,
      runs24h: aggByJob.get(row.job)?.runs ?? 0,
      failures24h: aggByJob.get(row.job)?.failures ?? 0,
    }))
    .sort((a, b) => a.job.localeCompare(b.job));
}
