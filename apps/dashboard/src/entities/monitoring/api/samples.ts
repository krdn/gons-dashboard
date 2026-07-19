// metric_samples 저장·윈도 조회 + 보드용 최신값 스냅샷.
import { eq, gte } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts, metricSamples } from "@/shared/lib/db/schema";
import {
  type ContainerStatRow,
  type HostMetricsSnapshot,
  type LatestMetric,
  type MetricSampleRow,
  type NewMetricSample,
} from "../model/types";

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

interface JoinedSample {
  hostId: string;
  hostName: string;
  metric: string;
  value: number;
  labels: Record<string, string> | null;
  collectedAt: Date;
}

function labelKey(labels: Record<string, string> | null): string {
  return labels == null ? "" : JSON.stringify(labels);
}

async function getJoinedRecentSamples(since: Date): Promise<JoinedSample[]> {
  return db
    .select({
      hostId: metricSamples.hostId,
      hostName: hosts.name,
      metric: metricSamples.metric,
      value: metricSamples.value,
      labels: metricSamples.labels,
      collectedAt: metricSamples.collectedAt,
    })
    .from(metricSamples)
    .innerJoin(hosts, eq(metricSamples.hostId, hosts.id))
    .where(gte(metricSamples.collectedAt, since));
}

/**
 * 호스트별 vitals 최신값 스냅샷 (container.* 제외).
 * 기본 윈도 30분 — 에이전트가 죽어도 한동안 스냅샷을 유지해 UI 가
 * "마지막 수집 N초 전" stale 경고를 보여줄 수 있게 한다.
 */
export async function getLatestHostMetrics(
  windowMs = 30 * 60_000,
): Promise<HostMetricsSnapshot[]> {
  const rows = await getJoinedRecentSamples(new Date(Date.now() - windowMs));

  const byHost = new Map<
    string,
    { hostName: string; latest: Map<string, LatestMetric> }
  >();
  for (const row of rows) {
    if (row.metric.startsWith("container.")) continue;
    let host = byHost.get(row.hostId);
    if (host == null) {
      host = { hostName: row.hostName, latest: new Map() };
      byHost.set(row.hostId, host);
    }
    const key = `${row.metric}|${labelKey(row.labels)}`;
    const prev = host.latest.get(key);
    if (prev == null || prev.collectedAt < row.collectedAt) {
      host.latest.set(key, {
        metric: row.metric,
        value: row.value,
        labels: row.labels,
        collectedAt: row.collectedAt,
      });
    }
  }

  return [...byHost.entries()]
    .map(([hostId, { hostName, latest }]) => {
      const metrics = [...latest.values()];
      const lastCollectedAt = metrics.reduce<Date | null>(
        (max, m) => (max == null || m.collectedAt > max ? m.collectedAt : max),
        null,
      );
      return { hostId, hostName, metrics, lastCollectedAt };
    })
    .sort((a, b) => a.hostName.localeCompare(b.hostName));
}

/** 컨테이너별 stats 최신값 (기본 윈도 3분 — 1분 주기 수집 대비 여유). */
export async function getLatestContainerStats(
  windowMs = 3 * 60_000,
): Promise<ContainerStatRow[]> {
  const rows = await getJoinedRecentSamples(new Date(Date.now() - windowMs));

  const byContainer = new Map<
    string,
    { hostName: string; container: string; latest: Map<string, LatestMetric> }
  >();
  for (const row of rows) {
    if (!row.metric.startsWith("container.")) continue;
    const container = row.labels?.container;
    if (container == null) continue;
    const key = `${row.hostName}|${container}`;
    let entry = byContainer.get(key);
    if (entry == null) {
      entry = { hostName: row.hostName, container, latest: new Map() };
      byContainer.set(key, entry);
    }
    const prev = entry.latest.get(row.metric);
    if (prev == null || prev.collectedAt < row.collectedAt) {
      entry.latest.set(row.metric, {
        metric: row.metric,
        value: row.value,
        labels: row.labels,
        collectedAt: row.collectedAt,
      });
    }
  }

  return [...byContainer.values()]
    .map(({ hostName, container, latest }) => {
      const cpu = latest.get("container.cpu_pct");
      const mem = latest.get("container.mem_pct");
      const memMb = latest.get("container.mem_used_mb");
      if (cpu == null) return null;
      return {
        hostName,
        container,
        cpuPct: cpu.value,
        memPct: mem?.value ?? 0,
        memUsedMb: memMb?.value ?? 0,
        collectedAt: cpu.collectedAt,
      };
    })
    .filter((r): r is ContainerStatRow => r != null)
    .sort((a, b) => b.cpuPct - a.cpuPct);
}
