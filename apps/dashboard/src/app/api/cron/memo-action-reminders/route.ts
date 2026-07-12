// 매시간 37분 KST — 수락된 할일·일정의 기한 도래 리마인더 push (시간 단위 해상도).
//
// 멱등: reminded_at 기록 후 대상에서 제외. push 실패·구독 없음이어도 기록 —
// 무한 재시도 방지 (스펙 §5). 발송은 remindDueActionItem이 담당.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { listDueReminders } from "@/entities/memo/server";
import { remindDueActionItem } from "@/features/memo-actions";

export const dynamic = "force-dynamic";

const SWEEP_LIMIT = 100;

export const POST = createCronHandler({
  name: "memo-action-reminders",
  targetSelect: () => listDueReminders(new Date(), SWEEP_LIMIT),
  getId: (item) => item.id,
  getLabel: (item) => item.title.slice(0, 40),
  perTarget: (item) => remindDueActionItem(item),
  concurrency: 2,
});
