// 관제 엔티티 타입 — 스키마 추론 + 위젯 소비 형태.
import {
  type metricSamples,
  type monitoringEvents,
} from "@/shared/lib/db/schema";

export type MetricSampleRow = typeof metricSamples.$inferSelect;
export type NewMetricSample = typeof metricSamples.$inferInsert;
export type MonitoringEventRow = typeof monitoringEvents.$inferSelect;

export type EventSeverity = "critical" | "warning" | "info";
export type EventSource =
  | "host"
  | "container"
  | "cron"
  | "service"
  | "security"
  | "ssl"
  | "http";

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
