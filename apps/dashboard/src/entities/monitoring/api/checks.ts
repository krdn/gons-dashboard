// check_results 기록·조회 (이슈 #323 Phase 2).
//
// (kind, target) 최신 row 가 "현재 상태" — 보드는 listLatestChecks 로,
// HTTP 연속 실패 판정은 getRecentChecks 로 직전 N회를 본다. 48h 보존.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { checkResults } from "@/shared/lib/db/schema";
import {
  type CheckResultRow,
  type LatestCheck,
  type NewCheckResult,
} from "../model/types";

export async function insertCheckResults(
  rows: NewCheckResult[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await db.insert(checkResults).values(rows);
  return rows.length;
}

export async function listLatestChecks(): Promise<LatestCheck[]> {
  // (kind, target)별 최신 1건 — 매분 쓰기 kind(http)가 있어 전체 로드 대신
  // DISTINCT ON (check_results_kind_target_time_idx 활용).
  // 주의: raw execute 는 drizzle 타입 매핑을 거치지 않아 timestamptz 가
  // 문자열로 올 수 있다 — new Date() 로 정규화 (cronRuns.ts 관례).
  const rows = await db.execute<{
    kind: string;
    target: string;
    status: string;
    detail: Record<string, string | number | boolean> | null;
    checked_at: Date | string;
  }>(sql`
    SELECT DISTINCT ON (kind, target) kind, target, status, detail, checked_at
    FROM check_results
    ORDER BY kind, target, checked_at DESC
  `);

  return [...rows].map((row) => ({
    kind: row.kind,
    target: row.target,
    status: row.status,
    detail: row.detail,
    checkedAt: new Date(row.checked_at),
  }));
}

/** (kind, target)의 최근 결과 — 최신순. HTTP 3연속 실패 판정용. */
export async function getRecentChecks(
  kind: string,
  target: string,
  limit: number,
): Promise<CheckResultRow[]> {
  return db
    .select()
    .from(checkResults)
    .where(and(eq(checkResults.kind, kind), eq(checkResults.target, target)))
    .orderBy(desc(checkResults.checkedAt))
    .limit(limit);
}
