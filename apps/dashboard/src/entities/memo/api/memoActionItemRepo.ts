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
 * 추출 결과 삽입 + memos.actions_extracted_at 마킹 — 단일 트랜잭션, claim-first.
 * 마킹을 IS NULL 조건부 UPDATE로 "먼저" 실행해 승자만 insert한다 — after() 추출과
 * cron sweep의 동시 실행이 제안을 중복 삽입하는 경합 차단 (리뷰 확정 결함:
 * row lock이 두 트랜잭션을 직렬화하고 패자는 0-row로 skip).
 * 반환 null = 다른 경로가 이미 추출함 (호출자는 already-extracted로 처리).
 */
export async function insertActionItemsAndMark(
  memoId: string,
  userId: string,
  items: NewActionItem[],
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(memos)
      .set({ actionsExtractedAt: new Date() })
      .where(and(eq(memos.id, memoId), isNull(memos.actionsExtractedAt)))
      .returning({ id: memos.id });
    if (claimed.length === 0) return null;

    if (items.length > 0) {
      await tx
        .insert(memoActionItems)
        .values(items.map((item) => ({ ...item, memoId, userId })));
    }
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

export type DueReminderItem = MemoActionItem & { memoTitle: string };

/** 리마인더 cron 대상 — 수락됨 + 기한 도래 + 미발송 (전 사용자). push body용 메모 제목 JOIN (스펙 §7). */
export async function listDueReminders(now: Date, limit: number): Promise<DueReminderItem[]> {
  const rows = await db
    .select({ item: memoActionItems, memoTitle: memos.title })
    .from(memoActionItems)
    .innerJoin(memos, eq(memoActionItems.memoId, memos.id))
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
  return rows.map((row) => ({ ...row.item, memoTitle: row.memoTitle }));
}

/** push 결과와 무관하게 기록 — 구독 없음/VAPID 미설정이 무한 재시도가 되지 않게 (스펙 §5). */
export async function markActionItemReminded(id: string): Promise<void> {
  await db
    .update(memoActionItems)
    .set({ remindedAt: new Date(), updatedAt: new Date() })
    .where(eq(memoActionItems.id, id));
}
