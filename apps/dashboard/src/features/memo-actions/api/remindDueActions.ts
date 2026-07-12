// 기한 도래 리마인더 — cron perTarget용 (스펙 §5).
import "server-only";
import { sendPushToUser } from "@/shared/lib/push";
import { markActionItemReminded } from "@/entities/memo/server";

const TITLE_MAX = 60;

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
}): Promise<RemindDueResult> {
  const push = await sendPushToUser(item.userId, {
    title: `⏰ ${item.title.slice(0, TITLE_MAX)}`,
    body: "메모에서 추출한 할 일의 기한입니다.",
    url: "/memos",
    tag: `memo-action-${item.id}`,
  });
  await markActionItemReminded(item.id);
  return { kind: "reminded", push: { total: push.total, sent: push.sent } };
}
