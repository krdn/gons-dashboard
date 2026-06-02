// entities/autopilot-cycle — cycle row upsert.
// 입력 JSON 키는 `date`(ISO datetime) — DB 컬럼 runAt(run_at)에 매핑한다 (CLAUDE.md 매핑 주의).
// id 충돌 시 onConflictDoUpdate 로 멱등 갱신.
import "server-only";
import { db } from "@/shared/lib/db/client";
import { autopilotCycles } from "@/shared/lib/db/schema";
import type { AutopilotCycleInput } from "../model/inputSchema";

function mapToRow(input: AutopilotCycleInput) {
  return {
    id: input.id,
    runAt: new Date(input.date),
    mode: input.mode,
    deployFlag: input.deployFlag ?? null,
    candidateCount: input.candidateCount,
    selectedTitle: input.selected?.title ?? null,
    selectedScore: input.selected?.score ?? null,
    selectedChangeType: input.selected?.changeType ?? null,
    selectedOwner: input.selected?.owner ?? null,
    prUrl: input.prUrl ?? null,
    merged: input.merged ?? false,
    needsHuman: input.needsHuman ?? false,
    reason: input.reason ?? null,
    backlogTop3: input.backlogTop3,
    debate: input.debate ?? null,
  };
}

export async function recordCycle(input: AutopilotCycleInput): Promise<void> {
  const row = mapToRow(input);
  await db
    .insert(autopilotCycles)
    .values(row)
    .onConflictDoUpdate({ target: autopilotCycles.id, set: row });
}
