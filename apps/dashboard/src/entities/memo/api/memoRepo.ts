import "server-only";
import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memos, memoTransformations } from "@/shared/lib/db/schema";
import type { Memo, MemoSource, MemoFact } from "../model/types";
import type { MemoCategory } from "../model/category";
import { tokenizeSearchQuery, escapeLike, SEARCH_MEMOS_LIMIT } from "../model/search";

// 개인 대시보드 규모 상한 — 페이지네이션 도입 전까지 unbounded 쿼리 방지.
const LIST_MEMOS_LIMIT = 200;

export function listMemos(userId: string, category: MemoCategory | null = null): Promise<Memo[]> {
  return db
    .select()
    .from(memos)
    .where(
      and(
        eq(memos.userId, userId),
        ...(category === null ? [] : [eq(memos.category, category)]),
      ),
    )
    .orderBy(desc(memos.createdAt))
    .limit(LIST_MEMOS_LIMIT);
}

/**
 * 인사이트 전용 조회 — 집계 축만 SELECT(전체 텍스트 제외), 캡 없음.
 * listMemos의 LIMIT 200은 인사이트에서 히트맵·총계·비율을 조용히 잘라 틀린 값을 낸다.
 * source는 bare text()라 select 타입이 string — MemoSource로 좁힌다(값은 DB CHECK로 보장).
 */
export async function listMemoFactsForInsights(userId: string): Promise<MemoFact[]> {
  const rows = await db
    .select({
      id: memos.id,
      source: memos.source,
      category: memos.category,
      createdAt: memos.createdAt,
      actionsExtractedAt: memos.actionsExtractedAt,
    })
    .from(memos)
    .where(eq(memos.userId, userId))
    .orderBy(asc(memos.createdAt));
  return rows.map((r) => ({ ...r, source: r.source as MemoSource }));
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
 * category는 WHERE 조건 — LIMIT 이후 클라이언트 필터는 false-empty를 만든다.
 */
export async function searchMemos(
  userId: string,
  query: string,
  category: MemoCategory | null = null,
): Promise<SearchMemosOutput> {
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
    .where(
      and(
        eq(memos.userId, userId),
        ...(category === null ? [] : [eq(memos.category, category)]),
        ...termConditions,
      ),
    )
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

/**
 * 카테고리 수동 정정 — 소유자 스코프 (사용자 트리거 UI 경로 전용).
 * updatedAt 미변경 (setMemoCategory와 동일 원칙 — 분류는 내용 편집이 아님).
 * 존재하지 않는 slug는 FK 위반으로 reject — 호출자가 failed로 처리.
 */
export async function setMemoCategoryOwned(
  userId: string,
  id: string,
  category: MemoCategory,
): Promise<boolean> {
  const rows = await db
    .update(memos)
    .set({ category })
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .returning({ id: memos.id });
  return rows.length > 0;
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

/** 다이제스트 창 조회 — [from, to) 반개구간, 오래된 순 (요약이 시간 흐름을 따르도록). */
export function listMemosBetween(userId: string, from: Date, to: Date): Promise<Memo[]> {
  return db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, userId), gte(memos.createdAt, from), lt(memos.createdAt, to)))
    .orderBy(asc(memos.createdAt))
    .limit(500);
}

/** 재부상 후보 — before 이전 생성분 전체 (개인 규모라 전수 로드 허용). */
export function listMemosOlderThan(userId: string, before: Date): Promise<Memo[]> {
  return db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, userId), lt(memos.createdAt, before)))
    .orderBy(asc(memos.createdAt))
    .limit(2000);
}

/** 재부상 표시용 — 소유자 스코프 id 조회 (삭제된 id는 결과에서 자연 누락). */
export function getMemosByIds(userId: string, ids: string[]): Promise<Memo[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, userId), inArray(memos.id, ids)));
}

/**
 * 액션 추출 sweep 대상 — 최근 windowHours 내 생성된 미추출 메모만.
 * 과거 백필 없음 — 오래된 메모의 상대 날짜("다음 주 화요일")는 기준점이 어긋나
 * 쓰레기 제안만 생성한다 (분류 backfill과 의도적으로 다른 결정, 스펙 §3).
 */
export function listMemosNeedingExtraction(
  now: Date,
  windowHours: number,
  limit: number,
): Promise<Memo[]> {
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  return db
    .select()
    .from(memos)
    .where(and(isNull(memos.actionsExtractedAt), gte(memos.createdAt, since)))
    .orderBy(asc(memos.createdAt))
    .limit(limit);
}

/** 다이제스트 cron 대상 — 메모를 1건이라도 가진 사용자. */
export async function listMemoAuthorUserIds(): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: memos.userId }).from(memos);
  return rows.map((r) => r.userId);
}

export async function deleteMemo(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .returning({ id: memos.id });
  return rows.length > 0;
}
