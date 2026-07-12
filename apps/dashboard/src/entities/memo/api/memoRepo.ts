import "server-only";
import { and, asc, desc, eq, exists, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memos, memoTransformations } from "@/shared/lib/db/schema";
import type { Memo, MemoSource } from "../model/types";
import type { MemoCategory } from "../model/category";
import { tokenizeSearchQuery, escapeLike, SEARCH_MEMOS_LIMIT } from "../model/search";

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

export interface SearchMemosOutput {
  memos: Memo[];
  /** 상한 초과 매칭 존재 여부 — LIMIT+1 센티널 조회로 정확히 판별 (정확히 50개일 때 거짓 절단 안내 방지). */
  truncated: boolean;
}

/**
 * 제목·원문·정리본·AI 변환본 대상 검색. 토큰 간 AND, 토큰별 필드 간 OR.
 * 개인 규모(사용자당 수백 행)라 인덱스 없이 user_id 필터 후 ILIKE로 충분 —
 * 임계 도달 시 pg_trgm GIN 인덱스만 추가하면 된다 (스펙 2026-07-12-memo-search).
 */
export async function searchMemos(userId: string, query: string): Promise<SearchMemosOutput> {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return { memos: [], truncated: false };

  const termConditions = tokens.map((token) => {
    const pattern = `%${escapeLike(token)}%`;
    return or(
      ilike(memos.title, pattern),
      ilike(memos.rawContent, pattern),
      ilike(memos.cleanedContent, pattern),
      exists(
        db
          .select({ one: sql`1` })
          .from(memoTransformations)
          .where(
            and(
              eq(memoTransformations.memoId, memos.id),
              ilike(memoTransformations.content, pattern),
            ),
          ),
      ),
    );
  });

  const rows = await db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, userId), ...termConditions))
    .orderBy(desc(memos.createdAt))
    .limit(SEARCH_MEMOS_LIMIT + 1);
  return {
    memos: rows.slice(0, SEARCH_MEMOS_LIMIT),
    truncated: rows.length > SEARCH_MEMOS_LIMIT,
  };
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

/**
 * 카테고리 영속화. userId 미요구 — 내부용 (분류 오케스트레이션 전용, 소유권은
 * 호출자가 보장). updatedAt은 건드리지 않는다 (내용 편집이 아니므로).
 */
export async function setMemoCategory(id: string, category: MemoCategory): Promise<void> {
  await db.update(memos).set({ category }).where(eq(memos.id, id));
}

/** cron sweep 대상 — 전 사용자 미분류 메모, 오래된 순 (백필이 과거부터 진행). */
export function listUnclassifiedMemos(limit: number): Promise<Memo[]> {
  return db
    .select()
    .from(memos)
    .where(isNull(memos.category))
    .orderBy(asc(memos.createdAt))
    .limit(limit);
}

export async function deleteMemo(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .returning({ id: memos.id });
  return rows.length > 0;
}
