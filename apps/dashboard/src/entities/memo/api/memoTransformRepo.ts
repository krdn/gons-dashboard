import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memos, memoTransformations } from "@/shared/lib/db/schema";
import type { MemoTransformation } from "../model/types";

export interface UpsertTransformationInput {
  memoId: string;
  preset: string;
  model: string;
  content: string;
  presetLabel: string | null;
}

/** 메모당 프리셋당 1개 — 재저장은 교체 (UNIQUE(memo_id, preset) upsert). */
export async function upsertTransformation(input: UpsertTransformationInput): Promise<MemoTransformation> {
  const rows = await db
    .insert(memoTransformations)
    .values(input)
    .onConflictDoUpdate({
      target: [memoTransformations.memoId, memoTransformations.preset],
      set: { content: input.content, model: input.model, presetLabel: input.presetLabel, updatedAt: new Date() },
    })
    .returning();
  return rows[0];
}

/** 소유자 메모들의 변환본 전체 — /memos 페이지 1쿼리 로드용 (N+1 회피). */
export async function listTransformationsByUser(userId: string): Promise<MemoTransformation[]> {
  const rows = await db
    .select({ transformation: memoTransformations })
    .from(memoTransformations)
    .innerJoin(memos, eq(memoTransformations.memoId, memos.id))
    .where(eq(memos.userId, userId));
  return rows.map((r) => r.transformation);
}
