// 매시간 KST — 미분류 메모 LLM 분류 sweep (백필 + 저장 직후 분류 실패 안전망).
//
// 멱등: 분류된 행은 category IS NULL 대상에서 빠진다. LLM 실패는 throw로
// status='error' 격리 → 행은 null 유지 → 다음 주기에 자연 재시도 (별도 retry 불필요).
// 상한 50건/회 — 기존 메모 전체 백필도 수 시간 내 완료 (개인 규모 수백 행).
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import {
  listUnclassifiedMemos,
  classifyAndPersistMemoCategory,
} from "@/entities/memo/server";

export const dynamic = "force-dynamic";

const SWEEP_LIMIT = 50;

export const POST = createCronHandler({
  name: "memo-classify",
  targetSelect: () => listUnclassifiedMemos(SWEEP_LIMIT),
  getId: (memo) => memo.id,
  perTarget: async (memo) => {
    const result = await classifyAndPersistMemoCategory(memo);
    // llm-unavailable을 error로 승격 — envelope failed 카운트로 관측 가능하게.
    if (result.kind === "llm-unavailable") throw new Error("llm-unavailable");
    return { kind: result.kind };
  },
  concurrency: 2,
});
