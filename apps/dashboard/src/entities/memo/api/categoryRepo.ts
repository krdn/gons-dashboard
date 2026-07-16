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

// 태그 등록은 memoRepo.fillMemoCategoryWithTag 안의 단일 트랜잭션으로 이동 —
// 분류 채움과 분리된 등록 경로를 남기면 경합 패자의 고아 태그가 사전에 남는다.
