// 관제 엔티티 server 진입점 (RSC·API route·cron 전용 — db 의존).
import "server-only";

export {
  recordEvent,
  resolveEvent,
  listRecentEvents,
  countOpenEvents,
  listUnnotifiedCriticalEvents,
  listUnnotifiedResolvedEvents,
  hasRecentNotification,
  markEventNotified,
  markEventResolvedNotified,
} from "./api/events";
export {
  insertMetricSamples,
  getRecentSamples,
  getLatestHostMetrics,
  getLatestContainerStats,
} from "./api/samples";
export { listCronRunBoard } from "./api/cronRuns";
export {
  insertCheckResults,
  listLatestChecks,
  getRecentChecks,
} from "./api/checks";
export type {
  MetricSampleRow,
  NewMetricSample,
  MonitoringEventRow,
  MonitoringEventInput,
  EventSeverity,
  EventSource,
  OpenEventCounts,
  LatestMetric,
  HostMetricsSnapshot,
  ContainerStatRow,
  CronRunBoardRow,
  CheckResultRow,
  NewCheckResult,
  CheckKind,
  CheckStatus,
  LatestCheck,
} from "./model/types";
