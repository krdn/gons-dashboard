// 관제 보드 조회 쿼리 통합 테스트 (test DB). per-run 프리픽스로 스코프.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts, cronRuns, remediationAttempts } from "@/shared/lib/db/schema";
import {
  insertMetricSamples,
  getLatestHostMetrics,
  getLatestContainerStats,
} from "@/entities/monitoring/api/samples";
import { listCronRunBoard } from "@/entities/monitoring/api/cronRuns";
import { listRecentRemediations } from "@/entities/monitoring/api/remediations";

const PREFIX = `mon-q-${Date.now()}-`;
const HOST_NAME = `${PREFIX}host`;

describe("monitoring board queries", () => {
  let hostId: string;

  beforeEach(async () => {
    await db.delete(hosts).where(like(hosts.name, `${PREFIX}%`));
    await db.delete(cronRuns).where(like(cronRuns.job, `${PREFIX}%`));
    await db
      .delete(remediationAttempts)
      .where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
    const [h] = await db
      .insert(hosts)
      .values({ name: HOST_NAME, dockerContext: "test" })
      .returning({ id: hosts.id });
    hostId = h.id;
  });

  afterAll(async () => {
    await db.delete(hosts).where(like(hosts.name, `${PREFIX}%`));
    await db.delete(cronRuns).where(like(cronRuns.job, `${PREFIX}%`));
    await db
      .delete(remediationAttempts)
      .where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
  });

  it("getLatestHostMetrics: 최신값만, container.* 제외, lastCollectedAt", async () => {
    const old = new Date(Date.now() - 60_000);
    const fresh = new Date();
    await insertMetricSamples([
      { hostId, metric: "cpu.pct", value: 50, labels: null, collectedAt: old },
      { hostId, metric: "cpu.pct", value: 12.5, labels: null, collectedAt: fresh },
      { hostId, metric: "disk.used_pct", value: 71, labels: { mount: "/" }, collectedAt: fresh },
      { hostId, metric: "disk.used_pct", value: 30, labels: { mount: "/data" }, collectedAt: fresh },
      { hostId, metric: "container.cpu_pct", value: 5, labels: { container: "x" }, collectedAt: fresh },
    ]);

    const snapshots = (await getLatestHostMetrics()).filter(
      (s) => s.hostName === HOST_NAME,
    );
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];

    const cpu = snap.metrics.filter((m) => m.metric === "cpu.pct");
    expect(cpu).toHaveLength(1);
    expect(cpu[0].value).toBe(12.5); // 최신값

    // mount 차원은 각각 유지
    expect(snap.metrics.filter((m) => m.metric === "disk.used_pct")).toHaveLength(2);
    // container.* 는 호스트 스냅샷에서 제외
    expect(snap.metrics.some((m) => m.metric.startsWith("container."))).toBe(false);
    expect(snap.lastCollectedAt?.getTime()).toBe(fresh.getTime());
  });

  it("getLatestContainerStats: 컨테이너별 최신 3지표 병합", async () => {
    const old = new Date(Date.now() - 90_000);
    const fresh = new Date();
    const labels = { container: `${PREFIX}app` };
    await insertMetricSamples([
      { hostId, metric: "container.cpu_pct", value: 99, labels, collectedAt: old },
      { hostId, metric: "container.cpu_pct", value: 1.2, labels, collectedAt: fresh },
      { hostId, metric: "container.mem_pct", value: 3.4, labels, collectedAt: fresh },
      { hostId, metric: "container.mem_used_mb", value: 123, labels, collectedAt: fresh },
    ]);

    const rows = (await getLatestContainerStats()).filter(
      (r) => r.hostName === HOST_NAME,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      container: `${PREFIX}app`,
      cpuPct: 1.2,
      memPct: 3.4,
      memUsedMb: 123,
    });
  });

  it("listCronRunBoard: job별 최신 1건 + 24h 집계", async () => {
    const now = Date.now();
    const jobA = `${PREFIX}job-a`;
    const jobB = `${PREFIX}job-b`;
    const mk = (job: string, agoMs: number, status: string) => ({
      job,
      startedAt: new Date(now - agoMs),
      finishedAt: new Date(now - agoMs + 1000),
      durationMs: 1000,
      status,
      total: 1,
      succeeded: status === "ok" ? 1 : 0,
      failed: status === "ok" ? 0 : 1,
    });
    await db.insert(cronRuns).values([
      mk(jobA, 26 * 3_600_000, "error"), // 24h 밖 — 집계 제외
      mk(jobA, 2 * 3_600_000, "error"),
      mk(jobA, 60_000, "ok"), // 최신
      mk(jobB, 30_000, "partial"),
    ]);

    const board = (await listCronRunBoard()).filter((r) =>
      r.job.startsWith(PREFIX),
    );
    expect(board).toHaveLength(2);

    const a = board.find((r) => r.job === jobA);
    expect(a).toMatchObject({ lastStatus: "ok", runs24h: 2, failures24h: 1 });
    expect(a!.lastRunAt.getTime()).toBe(now - 60_000);
    expect(a!.lastDurationMs).toBe(1000);

    const b = board.find((r) => r.job === jobB);
    expect(b).toMatchObject({ lastStatus: "partial", runs24h: 1, failures24h: 1 });
  });

  it("listRecentRemediations: 최신순 반환 + limit 적용", async () => {
    // 테이블 전체(다른 테스트 데이터 포함) 대상 정렬이라, 미래 시각을 써서
    // 이 시도들이 항상 가장 최신임을 보장한다 — limit 절단 검증을 결정적으로 만든다.
    const dedupKey = `${PREFIX}redis`;
    const future = Date.now() + 365 * 24 * 3600_000;
    await db.insert(remediationAttempts).values([
      {
        dedupKey,
        policyId: "redis-maxmemory",
        action: "a1",
        dryRun: true,
        outcome: "skipped",
        attemptedAt: new Date(future),
      },
      {
        dedupKey,
        policyId: "redis-maxmemory",
        action: "a2",
        dryRun: true,
        outcome: "dry_run",
        attemptedAt: new Date(future + 1000),
      },
      {
        dedupKey,
        policyId: "redis-maxmemory",
        action: "a3",
        dryRun: true,
        outcome: "failed",
        attemptedAt: new Date(future + 2000),
      },
    ]);

    const rows = await listRecentRemediations(2);
    expect(rows).toHaveLength(2);
    expect(rows[0].action).toBe("a3"); // 가장 최신
    expect(rows[1].action).toBe("a2");
  });
});
