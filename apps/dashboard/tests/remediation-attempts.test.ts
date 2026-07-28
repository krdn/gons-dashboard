// 원자적 실행권 획득 통합 테스트 (TEST_DATABASE_URL 필요).
import { describe, it, expect, beforeEach } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { remediationAttempts } from "@/shared/lib/db/schema";
import {
  claimAttempt,
  settleAttempt,
  loadHistory,
  reapStaleInFlight,
  recordSkip,
} from "@/features/monitoring-remediate/api/attempts";

const PREFIX = `rem-test-${Date.now()}-`;
const KEY = `${PREFIX}host:x:redis`;

const baseClaim = {
  eventId: null as unknown as string,
  dedupKey: KEY,
  policyId: "redis-maxmemory",
  action: "raise-redis-maxmemory",
  dryRun: true,
  detail: "{}",
};

describe("remediation attempts", () => {
  beforeEach(async () => {
    await db.delete(remediationAttempts).where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
  });

  it("claimAttempt: 실행권을 얻으면 id 반환", async () => {
    const id = await claimAttempt(baseClaim);
    expect(id).not.toBeNull();
  });

  // cron 주기보다 조치가 길면 두 사이클이 같은 대상을 집는다. 재시작이
  // 겹치면 복구 중 서비스를 다시 죽이므로 DB 가 중재해야 한다.
  it("동시 claim 5건 중 하나만 성공 (부분 unique index 방어)", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimAttempt(baseClaim)),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("settleAttempt 후에는 다시 claim 할 수 있다", async () => {
    const first = await claimAttempt(baseClaim);
    await settleAttempt(first!, "executed");
    const second = await claimAttempt(baseClaim);
    expect(second).not.toBeNull();
  });

  it("loadHistory: dedupKey 별로 이력을 모은다", async () => {
    const id = await claimAttempt(baseClaim);
    await settleAttempt(id!, "executed");
    const map = await loadHistory([KEY], new Date(Date.now() - 60_000));
    expect(map.get(KEY)).toHaveLength(1);
    expect(map.get(KEY)![0].outcome).toBe("executed");
  });

  // 프로세스가 조치 도중 죽으면 in_flight 가 남아 대상이 영구히 잠긴다.
  it("reapStaleInFlight: 오래된 in_flight 를 failed 로 정리", async () => {
    await claimAttempt(baseClaim);
    const reaped = await reapStaleInFlight(new Date(Date.now() + 60_000));
    expect(reaped).toBeGreaterThanOrEqual(1);
    const again = await claimAttempt(baseClaim);
    expect(again).not.toBeNull();
  });

  it("recordSkip: skip 도 기록에 남는다", async () => {
    await recordSkip({
      eventId: null as unknown as string,
      dedupKey: KEY,
      policyId: "redis-maxmemory",
      reason: "지속 시간 부족",
      dryRun: true,
    });
    const rows = await db
      .select()
      .from(remediationAttempts)
      .where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("skipped");
  });

  it("recordSkip: 같은 사유는 중복 억제 창 안에서 한 번만 기록한다", async () => {
    const input = {
      eventId: null as unknown as string,
      dedupKey: KEY,
      policyId: "redis-maxmemory",
      reason: "지속 시간 부족",
      dryRun: true,
    };
    await recordSkip(input);
    await recordSkip(input);
    const rows = await db
      .select()
      .from(remediationAttempts)
      .where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
    expect(rows).toHaveLength(1);
  });

  it("recordSkip: 사유가 다르면 각각 기록한다", async () => {
    const base = {
      eventId: null as unknown as string,
      dedupKey: KEY,
      policyId: "redis-maxmemory",
      dryRun: true,
    };
    await recordSkip({ ...base, reason: "지속 시간 부족" });
    await recordSkip({ ...base, reason: "쿨다운 중" });
    const rows = await db
      .select()
      .from(remediationAttempts)
      .where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
    expect(rows).toHaveLength(2);
  });

  it("recordSkip: 숫자만 다른 같은 종류의 사유는 한 번만 기록한다", async () => {
    const base = {
      eventId: null as unknown as string,
      dedupKey: KEY,
      policyId: "redis-maxmemory",
      dryRun: true,
    };
    await recordSkip({ ...base, reason: "지속 시간 부족 (10분 < 30분)" });
    await recordSkip({ ...base, reason: "지속 시간 부족 (15분 < 30분)" });
    const rows = await db
      .select()
      .from(remediationAttempts)
      .where(like(remediationAttempts.dedupKey, `${PREFIX}%`));
    expect(rows).toHaveLength(1);
  });
});
