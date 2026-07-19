// metric_samples 저장·윈도 조회.
import { gte } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { metricSamples } from "@/shared/lib/db/schema";
import { type MetricSampleRow, type NewMetricSample } from "../model/types";

export async function insertMetricSamples(
  rows: NewMetricSample[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await db.insert(metricSamples).values(rows);
  return rows.length;
}

/** since 이후 샘플 전체 — 보드가 JS reduce 로 최신값을 뽑는다 (윈도 3분 내외 소량). */
export async function getRecentSamples(since: Date): Promise<MetricSampleRow[]> {
  return db
    .select()
    .from(metricSamples)
    .where(gte(metricSamples.collectedAt, since));
}
