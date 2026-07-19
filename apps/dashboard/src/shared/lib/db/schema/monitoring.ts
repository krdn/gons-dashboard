// 관제(monitoring) 도메인 — 이슈 #323 Phase 1·2.
//
// metric_samples: 시계열 원본. 호스트 에이전트(15초)와 docker stats cron(1분)이
//   쓰기 — 쓰기 빈도가 높아 48h 보존 후 monitoring-purge cron 이 삭제한다.
// cron_runs: createCronHandler 계측 결과 (30d 보존).
// monitoring_events: 임계값 위반 이벤트. dedup_key 로 open(resolvedAt null)
//   이벤트 중복을 억제하고, 정상 복귀 시 resolvedAt 을 채운다.
// check_results: 판정형 점검 결과 (Phase 2 — systemd 서비스/타이머, 호스트 cron,
//   HTTP, SSL). (kind, target) 최신 row 가 현재 상태, 48h 보존.
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
  uniqueIndex,
  jsonb,
  real,
} from "drizzle-orm/pg-core";
import { hosts } from "./infra";

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    // 메트릭 이름 카탈로그(고정): cpu.pct / load.1 / mem.used_pct / disk.used_pct{mount} /
    // temp.cpu_c / gpu.* / net.*_bps{iface} / uptime.sec / reboot.required / container.*{container}
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    // 차원 라벨 (예: { mount: "/" }, { container: "gons-dashboard" }). 없으면 null.
    labels: jsonb("labels").$type<Record<string, string>>(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("metric_samples_host_metric_time_idx").on(
      t.hostId,
      t.metric,
      t.collectedAt.desc(),
    ),
    // purge (collected_at < now()-48h) 스캔용
    index("metric_samples_time_idx").on(t.collectedAt),
  ],
);

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // createCronHandler def.name (예: "poll-gmail")
    job: text("job").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    // 'ok'(전건 성공) | 'partial'(일부 실패) | 'error'(전건 실패)
    status: text("status").notNull(),
    total: integer("total").notNull(),
    succeeded: integer("succeeded").notNull(),
    failed: integer("failed").notNull(),
  },
  (t) => [index("cron_runs_job_time_idx").on(t.job, t.startedAt.desc())],
);

export const monitoringEvents = pgTable(
  "monitoring_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 'host' | 'container' | 'cron' | 'service' | 'security' | 'ssl' | 'http'
    source: text("source").notNull(),
    // 'critical' | 'warning' | 'info'
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    // 동일 이벤트 재기록 억제 키 (예: "host:<hostId>:disk:/")
    dedupKey: text("dedup_key").notNull(),
    hostId: uuid("host_id").references(() => hosts.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // null = 미해소(open). 정상 복귀 시 채움.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // 알림 sweep(monitoring-notify cron) 마킹 — critical 발생/해소 통지 시각.
    // null = 미통지. cooldown 판정과 이중 발송 억제의 단일 소스.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    resolvedNotifiedAt: timestamp("resolved_notified_at", { withTimezone: true }),
  },
  (t) => [
    index("monitoring_events_dedup_idx").on(t.dedupKey, t.occurredAt.desc()),
    index("monitoring_events_time_idx").on(t.occurredAt.desc()),
    // 동시 recordEvent 가 동일 dedupKey 의 open 이벤트를 중복 생성하는 것을
    // DB 레벨에서 차단 (SELECT-then-INSERT race 방어 — Codex 리뷰 P1).
    uniqueIndex("monitoring_events_open_dedup_uq")
      .on(t.dedupKey)
      .where(sql`resolved_at is null`),
  ],
);

export const checkResults = pgTable(
  "check_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 'service' | 'timer' | 'hostcron' | 'http' | 'ssl'
    kind: text("kind").notNull(),
    // 점검 대상 식별자 (unit명 / cron잡명 / 도메인)
    target: text("target").notNull(),
    // 'ok' | 'warning' | 'critical' | 'unknown'
    status: text("status").notNull(),
    // kind별 부가 정보 (예: { latencyMs, httpStatus } / { daysLeft } / { active, nRestarts })
    detail: jsonb("detail").$type<Record<string, string | number | boolean>>(),
    hostId: uuid("host_id").references(() => hosts.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 보드(최신 상태) + 연속 실패 판정(직전 N회) 조회용
    index("check_results_kind_target_time_idx").on(
      t.kind,
      t.target,
      t.checkedAt.desc(),
    ),
    // purge (checked_at < now()-48h) 스캔용
    index("check_results_time_idx").on(t.checkedAt),
  ],
);
