"use server";

import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { isPlayMCPError } from "@/features/tiger-consult/lib/errors";
import { getYearlyInsight, getDailyFortune } from "@/features/tiger-consult";
import type { PlayMCPYearlyResult, PlayMCPDailyResult } from "@/entities/tiger-reading";

export interface LazyResult<T> {
  ok: boolean;
  payload?: T;
  error?: string;
  extra?: Record<string, unknown>;
}

// Server action 은 client 가 직접 호출 가능 (Next.js endpoint).
// page.tsx ownership gate 를 우회당하지 않도록 server action 자체에서 재검증.
async function assertProfileOwnership(profileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "UNAUTHORIZED" };
  const owns = await db
    .select({ id: playmcpProfiles.id })
    .from(playmcpProfiles)
    .where(and(eq(playmcpProfiles.id, profileId), eq(playmcpProfiles.userId, session.user.id)))
    .limit(1);
  if (!owns[0]) return { ok: false, error: "NOT_FOUND" };
  return { ok: true };
}

export async function fetchYearlyAction(profileId: string, year: number): Promise<LazyResult<PlayMCPYearlyResult>> {
  const guard = await assertProfileOwnership(profileId);
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const r = await getYearlyInsight(profileId, year);
    return { ok: true, payload: r.payload, extra: { year: r.year } };
  } catch (err) {
    return { ok: false, error: isPlayMCPError(err) ? err.message : "yearly fetch failed" };
  }
}

export async function fetchDailyAction(profileId: string): Promise<LazyResult<PlayMCPDailyResult>> {
  const guard = await assertProfileOwnership(profileId);
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    const r = await getDailyFortune(profileId);
    return { ok: true, payload: r.payload, extra: { forDateKst: r.forDateKst } };
  } catch (err) {
    return { ok: false, error: isPlayMCPError(err) ? err.message : "daily fetch failed" };
  }
}
