// check_results 엔티티 쿼리 통합 테스트 (test DB). per-run 프리픽스로 스코프.
import { describe, it, expect, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { checkResults } from "@/shared/lib/db/schema";
import {
  insertCheckResults,
  listLatestChecks,
  getRecentChecks,
} from "@/entities/monitoring/api/checks";

const PREFIX = `mon-c-${Date.now()}-`;

describe("check_results queries", () => {
  afterAll(async () => {
    await db.delete(checkResults).where(like(checkResults.target, `${PREFIX}%`));
  });

  it("insertCheckResults: 빈 배열은 0, 저장 후 건수 반환", async () => {
    expect(await insertCheckResults([])).toBe(0);
    const n = await insertCheckResults([
      {
        kind: "http",
        target: `${PREFIX}a.example`,
        status: "ok",
        detail: { latencyMs: 42, httpStatus: 200 },
        checkedAt: new Date(),
      },
    ]);
    expect(n).toBe(1);
  });

  it("listLatestChecks: (kind,target)별 최신 1건 + Date 정규화", async () => {
    const target = `${PREFIX}b.example`;
    const old = new Date(Date.now() - 120_000);
    const fresh = new Date();
    await insertCheckResults([
      { kind: "http", target, status: "critical", detail: {}, checkedAt: old },
      { kind: "http", target, status: "ok", detail: { latencyMs: 7 }, checkedAt: fresh },
      { kind: "ssl", target, status: "warning", detail: { daysLeft: 10 }, checkedAt: fresh },
    ]);

    const latest = (await listLatestChecks()).filter((c) =>
      c.target.startsWith(PREFIX),
    );
    const http = latest.find((c) => c.kind === "http" && c.target === target);
    expect(http).toMatchObject({ status: "ok", detail: { latencyMs: 7 } });
    expect(http!.checkedAt).toBeInstanceOf(Date);
    expect(http!.checkedAt.getTime()).toBe(fresh.getTime());
    const ssl = latest.find((c) => c.kind === "ssl" && c.target === target);
    expect(ssl).toMatchObject({ status: "warning", detail: { daysLeft: 10 } });
  });

  it("getRecentChecks: 최신순 limit", async () => {
    const target = `${PREFIX}c.example`;
    const base = Date.now();
    await insertCheckResults(
      [3, 2, 1].map((agoMin, i) => ({
        kind: "http",
        target,
        status: i === 2 ? "warning" : "ok",
        detail: {},
        checkedAt: new Date(base - agoMin * 60_000),
      })),
    );
    const recent = await getRecentChecks("http", target, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].status).toBe("warning"); // 최신(1분 전)
    expect(recent[0].checkedAt.getTime()).toBeGreaterThan(
      recent[1].checkedAt.getTime(),
    );
  });
});
