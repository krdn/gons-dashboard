// GitHub workflow run 의 status/conclusion 조합을 4값으로 정규화 — 순수 함수 (이슈 #323).
//
// GitHub 이 반환하는 값은 문서보다 넓고 새 값이 추가될 수 있다. 판정 함수가
// 모르는 값을 만나 조용히 오분류하지 않도록 여기서 한 번 좁힌다.
//
// ⚠️ inconclusive 를 성공으로도 실패로도 보지 않는 것이 핵심이다. 취소된 run 을
// failure 로 보면 사람이 의도적으로 중단한 빌드마다 critical 알림이 나가고,
// success 로 보면 실제로 검증되지 않은 커밋이 정상으로 표시된다.
import { logger } from "@/shared/lib/log";

export type RunOutcome = "success" | "failure" | "running" | "inconclusive";

const RUNNING_STATUSES = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);
const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "action_required",
]);
const INCONCLUSIVE_CONCLUSIONS = new Set(["cancelled", "skipped", "neutral", "stale"]);

export function normalizeRunOutcome(run: {
  status: string;
  conclusion: string | null;
}): RunOutcome {
  // status 를 먼저 본다 — 진행 중이면 conclusion 은 아직 null 이다.
  if (RUNNING_STATUSES.has(run.status)) return "running";

  const { conclusion } = run;
  if (conclusion === "success") return "success";
  if (conclusion != null && FAILURE_CONCLUSIONS.has(conclusion)) return "failure";
  if (conclusion == null || INCONCLUSIVE_CONCLUSIONS.has(conclusion)) return "inconclusive";

  // 미지의 값 — GitHub 이 새 conclusion 을 도입했을 때 알 수 있게 남긴다.
  logger.warn("github-monitor", "unknown-run-conclusion", {
    status: run.status,
    conclusion,
  });
  return "inconclusive";
}
