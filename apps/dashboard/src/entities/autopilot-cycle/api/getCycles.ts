// entities/autopilot-cycle — 최근 사이클 이력 읽기.
// DB 컬럼 runAt(run_at) → AutopilotCycle.runAt 직접 매핑 (CLAUDE.md 매핑 주의).
import "server-only";
import { db } from "@/shared/lib/db/client";
import { autopilotCycles } from "@/shared/lib/db/schema";
import { desc } from "drizzle-orm";
import type { AutopilotCycle } from "../model/types";

const HISTORY_LIMIT = 8;

function rowToCycle(row: typeof autopilotCycles.$inferSelect): AutopilotCycle {
  return {
    id: row.id,
    isoWeek: row.id.replace(/^autopilot-/, ""),
    runAt: row.runAt,
    mode: row.mode,
    deployFlag: row.deployFlag as "on" | "off" | null,
    candidateCount: row.candidateCount,
    selectedTitle: row.selectedTitle,
    selectedScore: row.selectedScore,
    selectedChangeType: row.selectedChangeType,
    selectedOwner: row.selectedOwner,
    prUrl: row.prUrl,
    merged: row.merged,
    needsHuman: row.needsHuman,
    reason: row.reason,
    backlogTop3: row.backlogTop3,
  };
}

/** 최근 사이클 N건 (createdAt desc). 조회 실패 시 빈 배열 — 위젯 graceful degrade. */
export async function getCycles(limit = HISTORY_LIMIT): Promise<AutopilotCycle[]> {
  return db
    .select()
    .from(autopilotCycles)
    .orderBy(desc(autopilotCycles.createdAt))
    .limit(limit)
    .then(
      (rows) => rows.map(rowToCycle),
      (e) => {
        console.error("[autopilot] getCycles failed:", e);
        return [];
      },
    );
}
