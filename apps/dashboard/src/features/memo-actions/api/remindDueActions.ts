// 기한 도래 리마인더 — cron perTarget용 (스펙 §5).
import "server-only";
import { sendPushToUser } from "@/shared/lib/push";
import { logger } from "@/shared/lib/log";
import { markActionItemReminded } from "@/entities/memo/server";

const TITLE_MAX = 60;
const BODY_MAX = 80;

export interface RemindDueResult {
  kind: "reminded";
  push: { total: number; sent: number };
}

/**
 * push 발송 후 reminded_at 기록. push 실패·구독 없음·VAPID 미설정이어도 기록 —
 * 리마인더가 매시간 무한 재시도로 변하는 것을 방지 (스펙 §5 명시 결정).
 */
export async function remindDueActionItem(item: {
  id: string;
  userId: string;
  title: string;
  memoTitle: string;
}): Promise<RemindDueResult> {
  const push = await sendPushToUser(item.userId, {
    title: `⏰ ${item.title.slice(0, TITLE_MAX)}`,
    body: item.memoTitle.slice(0, BODY_MAX), // 출처 메모 제목 (스펙 §7)
    url: "/memos",
    tag: `memo-action-${item.id}`,
  });
  // 발송(비가역) 뒤 bookkeeping은 별도 try + best-effort (PR #157 관례) —
  // mark 실패가 push 성공을 error로 가리지 않게. 실패 시 다음 주기 1회 중복 감수.
  try {
    await markActionItemReminded(item.id);
  } catch (error) {
    logger.warn("memo-action-reminders", "mark-reminded-failed", {
      id: item.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { kind: "reminded", push: { total: push.total, sent: push.sent } };
}
