import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoDigests } from "@/shared/lib/db/schema";
import type { MemoDigest } from "../model/types";

export interface InsertDigestInput {
  userId: string;
  weekEnd: string; // 'YYYY-MM-DD'
  summary: string;
  memoCount: number;
  resurfacedMemoIds: string[];
}

/**
 * 멱등 삽입 — unique(user_id, week_end) 충돌 시 null 반환 (동시 실행 방어).
 * 호출자는 null이면 이미 생성된 것으로 간주하고 push를 보내지 않는다.
 */
export async function insertDigest(input: InsertDigestInput): Promise<MemoDigest | null> {
  const rows = await db.insert(memoDigests).values(input).onConflictDoNothing().returning();
  return rows[0] ?? null;
}

export async function hasDigest(userId: string, weekEnd: string): Promise<boolean> {
  const rows = await db
    .select({ id: memoDigests.id })
    .from(memoDigests)
    .where(and(eq(memoDigests.userId, userId), eq(memoDigests.weekEnd, weekEnd)))
    .limit(1);
  return rows.length > 0;
}

export async function getLatestDigest(userId: string): Promise<MemoDigest | null> {
  const rows = await db
    .select()
    .from(memoDigests)
    .where(eq(memoDigests.userId, userId))
    .orderBy(desc(memoDigests.weekEnd))
    .limit(1);
  return rows[0] ?? null;
}
