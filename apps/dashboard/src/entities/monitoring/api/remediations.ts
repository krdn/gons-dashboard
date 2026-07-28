// remediation_attempts 최근 시도 조회 — Phase 1 dry-run 로그 검토 보드용 (이슈 #352).
import { desc } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { remediationAttempts } from "@/shared/lib/db/schema";
import { type RemediationAttemptRow } from "../model/types";

export async function listRecentRemediations(
  limit = 50,
): Promise<RemediationAttemptRow[]> {
  return db
    .select()
    .from(remediationAttempts)
    .orderBy(desc(remediationAttempts.attemptedAt))
    .limit(limit);
}
