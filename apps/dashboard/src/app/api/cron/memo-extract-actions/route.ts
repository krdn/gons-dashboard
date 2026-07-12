// 매시간 41분 KST — 48h 창 내 미추출 메모 액션 추출 sweep (저장 직후 after() 실패 안전망).
//
// 과거 백필 없음 — 오래된 메모의 상대 날짜는 기준점이 어긋난다 (스펙 §3).
// LLM 실패는 throw로 status='error' 격리 → 마커 미기록 → 다음 주기 재시도 (48h 창 내).
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { listMemosNeedingExtraction } from "@/entities/memo/server";
import { extractAndPersistMemoActions } from "@/features/memo-actions";

export const dynamic = "force-dynamic";

const WINDOW_HOURS = 48;
const SWEEP_LIMIT = 50;

export const POST = createCronHandler({
  name: "memo-extract-actions",
  targetSelect: () => listMemosNeedingExtraction(new Date(), WINDOW_HOURS, SWEEP_LIMIT),
  getId: (memo) => memo.id,
  perTarget: async (memo) => {
    const result = await extractAndPersistMemoActions(memo, new Date());
    if (result.kind === "llm-unavailable") throw new Error("llm-unavailable");
    return result;
  },
  concurrency: 2,
});
