import "server-only";
import { and, asc, eq, inArray, isNull, isNotNull, lte } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoActionItems, memos } from "@/shared/lib/db/schema";
import type { MemoActionItem } from "../model/types";
import {
  ACTION_ITEM_ALLOWED_FROM,
  type ActionItemKind,
  type ActionItemStatus,
} from "../model/actionItem";

export interface NewActionItem {
  kind: ActionItemKind;
  title: string;
  dueAt: Date | null;
  allDay: boolean;
}

/**
 * 추출 결과 삽입 + memos.actions_extracted_at 마킹 — 단일 트랜잭션.
 * 분리하면 부분 실패 시 (insert만 성공 → 재추출로 제안 중복) / (마킹만 성공 → 제안 유실).
 */
export async function insertActionItemsAndMark(
  memoId: string,
  userId: string,
  items: NewActionItem[],
): Promise<number> {
  return db.transaction(async (tx) => {
    if (items.length > 0) {
      await tx
        .insert(memoActionItems)
        .values(items.map((item) => ({ ...item, memoId, userId })));
    }
    await tx
      .update(memos)
      .set({ actionsExtractedAt: new Date() })
      .where(eq(memos.id, memoId));
    return items.length;
  });
}

/** 패널 표시용 — proposed/accepted만 조회하는 것이 관례 (dismissed/done 숨김, 스펙 §5). */
export function listActionItemsByUser(
  userId: string,
  statuses: ActionItemStatus[],
): Promise<MemoActionItem[]> {
  return db
    .select()
    .from(memoActionItems)
    .where(and(eq(memoActionItems.userId, userId), inArray(memoActionItems.status, statuses)))
    .orderBy(asc(memoActionItems.createdAt));
}

/**
 * 상태 전이 — WHERE에 소유권 + 허용 출발 상태를 함께 강제 (불법 전이·타인 항목·
 * 동시 전이 경합 모두 0-row로 수렴 → null 반환).
 */
export async function updateActionItemStatus(
  userId: string,
  id: string,
  to: ActionItemStatus,
): Promise<MemoActionItem | null> {
  const allowedFrom = ACTION_ITEM_ALLOWED_FROM[to];
  if (allowedFrom.length === 0) return null; // proposed로의 전이는 존재하지 않는다
  const rows = await db
    .update(memoActionItems)
    .set({ status: to, updatedAt: new Date() })
    .where(
      and(
        eq(memoActionItems.id, id),
        eq(memoActionItems.userId, userId),
        inArray(memoActionItems.status, [...allowedFrom]),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** 리마인더 cron 대상 — 수락됨 + 기한 도래 + 미발송 (전 사용자). */
export function listDueReminders(now: Date, limit: number): Promise<MemoActionItem[]> {
  return db
    .select()
    .from(memoActionItems)
    .where(
      and(
        eq(memoActionItems.status, "accepted"),
        isNotNull(memoActionItems.dueAt),
        lte(memoActionItems.dueAt, now),
        isNull(memoActionItems.remindedAt),
      ),
    )
    .orderBy(asc(memoActionItems.dueAt))
    .limit(limit);
}

/** push 결과와 무관하게 기록 — 구독 없음/VAPID 미설정이 무한 재시도가 되지 않게 (스펙 §5). */
export async function markActionItemReminded(id: string): Promise<void> {
  await db
    .update(memoActionItems)
    .set({ remindedAt: new Date(), updatedAt: new Date() })
    .where(eq(memoActionItems.id, id));
}
