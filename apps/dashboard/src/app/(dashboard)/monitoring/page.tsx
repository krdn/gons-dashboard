// /monitoring — 실시간 관제 보드 (이슈 #323 Phase 1).
// 시선 흐름: KPI 스트립(5초 판단) → Vitals 히어로 + 이벤트 타임라인 → 드릴다운 표.
// 갱신: AutoRefresh 15초 폴링 (RSC 재요청 — SSE 는 폴링 한계 도달 시에만, §3).
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { env } from "@/shared/config/env";
import {
  countOpenEvents,
  getLatestContainerStats,
  getLatestHostMetrics,
  getSajuLlmSpend,
  listCronRunBoard,
  listLatestChecks,
  listRecentEvents,
} from "@/entities/monitoring/server";
import {
  AutoRefresh,
  AvailabilityBoard,
  ContainerStatsBoard,
  CronRunsBoard,
  EventsTimeline,
  HostCronBoard,
  DatastoreBoard,
  LlmCostCard,
  SecurityBoard,
  ServicesBoard,
  StatusDot,
  VitalsBoard,
  type OverallStatus,
} from "@/widgets/monitoring";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

function Kpi({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-2xl font-bold tabular-nums">{children}</div>
    </div>
  );
}

export default async function MonitoringPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const now = new Date();
  const [snapshots, containers, cronBoard, events, open, checks, llmSpend] =
    await Promise.all([
      getLatestHostMetrics(),
      getLatestContainerStats(),
      listCronRunBoard(),
      listRecentEvents(50),
      countOpenEvents(),
      listLatestChecks(),
      getSajuLlmSpend(now),
    ]);
  const byKind = (kind: string) => checks.filter((c) => c.kind === kind);
  // 보안 kind 는 한 보드에 모아 표시한다 (kind 하나당 target 하나).
  const SECURITY_KINDS = new Set([
    "iptables",
    "fail2ban",
    "ufw",
    "portdrift",
    "sshfail",
  ]);

  const status: OverallStatus =
    open.critical > 0 ? "critical" : open.warning > 0 ? "warning" : "ok";
  const firstHost = snapshots[0];
  const cpu = firstHost?.metrics.find((m) => m.metric === "cpu.pct")?.value;
  const mem = firstHost?.metrics.find((m) => m.metric === "mem.used_pct")?.value;
  const maxDisk = snapshots
    .flatMap((s) => s.metrics.filter((m) => m.metric === "disk.used_pct"))
    .reduce<number | null>((max, m) => (max == null || m.value > max ? m.value : max), null);

  return (
    <PageContainer>
      <AutoRefresh intervalMs={15_000} />
      <PageHeader
        title="관제"
        subtitle="호스트·컨테이너·cron 실시간 상태 — 15초 자동 갱신"
      />

      {/* KPI 스트립 — 5초 판단 영역 (3-5개 제한) */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="전체 상태">
          <StatusDot status={status} />
        </Kpi>
        <Kpi label="미해결 이벤트">
          <span
            style={{
              color:
                open.critical > 0
                  ? "var(--color-severity-high)"
                  : open.warning > 0
                    ? "var(--color-warn)"
                    : "var(--color-text)",
            }}
          >
            {open.critical + open.warning}
          </span>
        </Kpi>
        <Kpi label={`CPU ${firstHost ? `(${firstHost.hostName})` : ""}`}>
          {cpu != null ? `${cpu.toFixed(1)}%` : "–"}
        </Kpi>
        <Kpi label="메모리 / 디스크 최대">
          {mem != null ? `${mem.toFixed(0)}%` : "–"}
          <span className="text-[var(--color-text-muted)]"> / </span>
          {maxDisk != null ? `${Math.round(maxDisk)}%` : "–"}
        </Kpi>
      </div>

      {/* 히어로: Vitals(7fr) + 이벤트 타임라인(4fr) */}
      <div className="mb-6 grid gap-6 md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <VitalsBoard snapshots={snapshots} now={now} />
        <EventsTimeline events={events} now={now} />
      </div>

      {/* 드릴다운 표 */}
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <AvailabilityBoard http={byKind("http")} ssl={byKind("ssl")} now={now} />
          <ServicesBoard
            services={byKind("service")}
            timers={byKind("timer")}
            now={now}
          />
        </div>
        <ContainerStatsBoard
          rows={containers}
          multiHost={new Set(containers.map((c) => c.hostName)).size > 1}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <CronRunsBoard rows={cronBoard} now={now} />
          <HostCronBoard rows={byKind("hostcron")} now={now} />
        </div>
        <SecurityBoard
          checks={checks.filter((c) => SECURITY_KINDS.has(c.kind))}
          now={now}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <DatastoreBoard
            checks={checks.filter((c) => c.kind === "pg" || c.kind === "redis")}
            now={now}
          />
          <LlmCostCard spend={llmSpend} budgetKrw={env.SAJU_LLM_DAILY_BUDGET_KRW} />
        </div>
      </div>
    </PageContainer>
  );
}
