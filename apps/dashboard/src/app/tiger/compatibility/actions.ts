"use server";

import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { getCompatibility } from "@/features/tiger-consult";
import { isPlayMCPError } from "@/features/tiger-consult/lib/errors";
import type { PlayMCPCompatibilityResult } from "@/entities/tiger-reading";

export interface CompatActionResult {
  ok: boolean;
  payload?: PlayMCPCompatibilityResult;
  nickname1?: string;
  nickname2?: string;
  error?: string;
}

// Server action 은 client 가 직접 호출 가능 (Next.js endpoint).
// 두 profile 모두 본인 소유인지 검증해야 IDOR 차단.
async function assertProfilesOwnership(
  aId: string,
  bId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "UNAUTHORIZED" };
  const owns = await db
    .select({ id: playmcpProfiles.id })
    .from(playmcpProfiles)
    .where(
      and(
        inArray(playmcpProfiles.id, [aId, bId]),
        eq(playmcpProfiles.userId, session.user.id),
      ),
    );
  if (owns.length !== 2) return { ok: false, error: "NOT_FOUND" };
  return { ok: true };
}

export async function fetchCompatibilityAction(aId: string, bId: string): Promise<CompatActionResult> {
  if (aId === bId) return { ok: false, error: "같은 사람으로는 궁합 분석 불가" };
  const guard = await assertProfilesOwnership(aId, bId);
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const r = await getCompatibility(aId, bId);
    return { ok: true, payload: r.payload, nickname1: r.profile1.nickname, nickname2: r.profile2.nickname };
  } catch (err) {
    return { ok: false, error: isPlayMCPError(err) ? err.message : "compatibility fetch failed" };
  }
}
