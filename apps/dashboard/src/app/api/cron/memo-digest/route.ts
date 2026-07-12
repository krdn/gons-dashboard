// 매일 19:05 KST 트리거 — 주간 메모 다이제스트 (due 판정은 feature 레이어).
//
// 일요일 19:00 이후가 due — 일요일 저녁 정상 발화, 컨테이너가 그 시각에 죽어
// 있었으면 다음 날 catchup (morning-digest의 "잦은 트리거 + DB due-gating" 전례의
// 주간 일반화). 멱등: memo_digests unique(user_id, week_end).
// LLM 실패는 perTarget throw → envelope error 격리 → 다음 날 재시도.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { listMemoAuthorUserIds } from "@/entities/memo/server";
import { generateWeeklyDigest } from "@/features/memo-digest";

export const dynamic = "force-dynamic";

export const POST = createCronHandler({
  name: "memo-digest",
  targetSelect: async () => listMemoAuthorUserIds(),
  getId: (userId) => userId,
  perTarget: (userId) => generateWeeklyDigest(userId, new Date()),
  concurrency: 2,
});
