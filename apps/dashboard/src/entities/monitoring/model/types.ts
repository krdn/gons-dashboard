// 관제 엔티티 타입 — 스키마 추론 + 위젯 소비 형태.
import {
  type checkResults,
  type metricSamples,
  type monitoringEvents,
} from "@/shared/lib/db/schema";

export type MetricSampleRow = typeof metricSamples.$inferSelect;
export type NewMetricSample = typeof metricSamples.$inferInsert;
export type MonitoringEventRow = typeof monitoringEvents.$inferSelect;
export type CheckResultRow = typeof checkResults.$inferSelect;
export type NewCheckResult = typeof checkResults.$inferInsert;

export type CheckKind =
  | "service"
  | "timer"
  | "hostcron"
  | "http"
  | "ssl"
  // Phase 3 §H 보안 — root collector 관측치 기반
  | "iptables"
  | "fail2ban"
  | "ufw"
  | "portdrift"
  | "sshfail"
  // Phase 3 §G 데이터스토어 liveness
  | "pg"
  | "redis"
  // Phase 4 §J 데이터스토어 심층지표 — liveness 와 별개 행(별개 dedup)
  | "pgstat"
  | "redisstat";

/**
 * 점검 detail 값 — 배열은 Phase 3 에서 추가(포트 목록·jail 목록).
 * 판정(CheckVerdict) → DB(check_results.detail) → 조회(LatestCheck) 전 구간 동일해야 한다.
 */
export type CheckDetailValue = string | number | boolean | string[];
export type CheckStatus = "ok" | "warning" | "critical" | "unknown";

export type EventSeverity = "critical" | "warning" | "info";
export type EventSource =
  | "host"
  | "container"
  | "cron"
  | "service"
  | "security"
  | "ssl"
  | "http"
  | "github";

export interface MonitoringEventInput {
  source: EventSource;
  severity: EventSeverity;
  title: string;
  detail?: string;
  dedupKey: string;
  hostId?: string;
}

export interface OpenEventCounts {
  critical: number;
  warning: number;
}

/** 특정 (metric, labels 차원)의 최신 샘플. */
export interface LatestMetric {
  metric: string;
  value: number;
  labels: Record<string, string> | null;
  collectedAt: Date;
}

export interface HostMetricsSnapshot {
  hostId: string;
  hostName: string;
  metrics: LatestMetric[];
  lastCollectedAt: Date | null;
}

export interface ContainerStatRow {
  hostName: string;
  container: string;
  cpuPct: number;
  memPct: number;
  memUsedMb: number;
  collectedAt: Date;
}

export interface CronRunBoardRow {
  job: string;
  lastRunAt: Date;
  lastStatus: string;
  lastDurationMs: number;
  runs24h: number;
  failures24h: number;
}

/** (kind, target)별 최신 점검 결과 — 보드의 현재 상태 행. */
export interface LatestCheck {
  kind: string;
  target: string;
  status: string;
  detail: Record<string, CheckDetailValue> | null;
  checkedAt: Date;
}
