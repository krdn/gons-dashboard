import "server-only";
import { asc, desc } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoCategories } from "@/shared/lib/db/schema";

export interface MemoCategoryRow {
  id: string;
  labelKo: string;
  isSeed: boolean;
  createdAt: Date;
}

/** 전체 카테고리 — 시드 먼저(is_seed desc), 그 다음 오래된 순(created_at asc). */
export function listCategories(): Promise<MemoCategoryRow[]> {
  return db
    .select()
    .from(memoCategories)
    .orderBy(desc(memoCategories.isSeed), asc(memoCategories.createdAt));
}

/** 새 태그 등록. 이미 존재하면 no-op (라벨은 최초 등록만 유지 — 난립·덮어쓰기 방지). */
export async function upsertCategory(id: string, labelKo: string): Promise<void> {
  await db
    .insert(memoCategories)
    .values({ id, labelKo, isSeed: false })
    .onConflictDoNothing({ target: memoCategories.id });
}
