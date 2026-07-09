import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memos } from "@/shared/lib/db/schema";
import type { Memo, MemoSource } from "../model/types";

// 개인 대시보드 규모 상한 — 페이지네이션 도입 전까지 unbounded 쿼리 방지.
const LIST_MEMOS_LIMIT = 200;

export function listMemos(userId: string): Promise<Memo[]> {
  return db
    .select()
    .from(memos)
    .where(eq(memos.userId, userId))
    .orderBy(desc(memos.createdAt))
    .limit(LIST_MEMOS_LIMIT);
}

export async function getMemo(userId: string, id: string): Promise<Memo | null> {
  const rows = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateMemoInput {
  userId: string;
  source: MemoSource;
  title: string;
  rawContent: string;
  cleanedContent: string;
}

export async function createMemo(input: CreateMemoInput): Promise<Memo> {
  const rows = await db.insert(memos).values(input).returning();
  return rows[0];
}

export async function updateMemo(
  userId: string,
  id: string,
  patch: { title: string; cleanedContent: string },
): Promise<Memo | null> {
  const rows = await db
    .update(memos)
    .set({ title: patch.title, cleanedContent: patch.cleanedContent, updatedAt: new Date() })
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteMemo(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .returning({ id: memos.id });
  return rows.length > 0;
}
