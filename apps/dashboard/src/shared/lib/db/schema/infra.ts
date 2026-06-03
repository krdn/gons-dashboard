// 서버 인프라 모니터 도메인 — entities/host · entities/project · audit_logs
// + gons-autopilot 사이클 이력.
// - hosts: 등록된 docker context (다호스트 확장 대비, v0.1엔 home-server 1대)
// - projects: compose project 메타데이터 (display name, 카테고리, pinned)
// - audit_logs: 컨테이너 액션 이력 (read+admin 기록)
// - autopilot_cycles: 주간 자율 업그레이드 사이클 이력
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  real,
} from "drizzle-orm/pg-core";

export const hosts = pgTable("hosts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // "home-server"
  dockerContext: text("docker_context").notNull(), // docker CLI --context 인자
  // 호스트 IPv4 (선택). 0004 마이그레이션으로 추가. 현재 src/ 에서는 미사용이지만
  // 운영 DB·snapshot 정합을 위해 schema에 유지. 향후 디스플레이/연결 진단용.
  ip: text("ip"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    composeProject: text("compose_project").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    category: text("category"), // 'news' | 'ai' | 'infra' | 'experiment' | null
    url: text("url"),
    isPinned: boolean("is_pinned").notNull().default(false),
    isHidden: boolean("is_hidden").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_host_compose_idx").on(t.hostId, t.composeProject),
    index("projects_visible_idx").on(t.hostId, t.isHidden, t.isPinned),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id),
    containerId: text("container_id").notNull(),
    containerName: text("container_name").notNull(),
    action: text("action").notNull(), // 'restart' | 'start' | 'stop'
    userEmail: text("user_email").notNull(), // NextAuth session.user.email
    status: text("status").notNull(), // 'success' | 'failed'
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // 호스트별 최근 액션 조회: WHERE host_id = ? ORDER BY created_at DESC LIMIT 5
    index("audit_logs_host_recent_idx").on(t.hostId, t.createdAt.desc()),
  ],
);

/* gons-autopilot — 주간 자율 업그레이드 사이클 이력
 * 저장: POST /api/cron/autopilot-cycle (주간 에이전트가 Workflow 반환값 기록)
 * 읽기: widgets/autopilot (RSC)
 * id = "autopilot-<isoWeek>" 멱등 키. 주차별 index 불필요 (PK가 isoWeek). */
export const autopilotCycles = pgTable("autopilot_cycles", {
  id: text("id").primaryKey(), // "autopilot-2026-W24"
  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  mode: text("mode").notNull(), // "shadow" | "autonomous"
  deployFlag: text("deploy_flag"), // "on" | "off" | null — 저장 시점 cron의 AUTOPILOT_DEPLOY
  candidateCount: integer("candidate_count").notNull(),

  selectedTitle: text("selected_title"),
  selectedScore: real("selected_score"),
  selectedChangeType: text("selected_change_type"),
  selectedOwner: text("selected_owner"),

  prUrl: text("pr_url"),
  merged: boolean("merged").notNull().default(false),
  needsHuman: boolean("needs_human").notNull().default(false),
  reason: text("reason"),

  backlogTop3: jsonb("backlog_top3")
    .$type<{ title: string; score: number; dedupKey: string }[]>()
    .notNull()
    .default([]),
  debate: jsonb("debate"), // DebateLog — entity types에서 정제

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
