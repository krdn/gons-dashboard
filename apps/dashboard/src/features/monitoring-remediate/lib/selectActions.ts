// open 이벤트 → 실행할 조치 목록 (이슈 #352). 순수 함수.
//
// skip 을 조용히 버리지 않고 반환한다 — 왜 조치하지 않았는지가 감사 기록에
// 남아야 나중에 "자동화가 왜 안 돌았나" 를 추적할 수 있다.
import { POLICIES, type LiveFacts, type OpenEventView, type RemediationAction } from "../config/policies";
import { evaluateGuards, type AttemptSummary } from "./guards";

export type PlannedAction = {
  event: OpenEventView;
  policyId: string;
  action: RemediationAction;
};

export type PlannedSkip = {
  event: OpenEventView;
  policyId: string;
  reason: string;
};

export type SelectResult = {
  actions: PlannedAction[];
  skips: PlannedSkip[];
};

export function selectActions(
  events: OpenEventView[],
  historyByDedup: Map<string, AttemptSummary[]>,
  facts: LiveFacts,
  now: Date,
): SelectResult {
  const actions: PlannedAction[] = [];
  const skips: PlannedSkip[] = [];

  for (const event of events) {
    for (const policy of POLICIES) {
      const built = policy.buildAction(event, facts);
      if ("skip" in built) {
        skips.push({ event, policyId: policy.id, reason: built.skip });
        continue;
      }

      const verdict = evaluateGuards({
        severity: event.severity,
        occurredAt: event.occurredAt,
        maxAttempts: policy.maxAttempts,
        cooldownMinutes: policy.cooldownMinutes,
        history: historyByDedup.get(event.dedupKey) ?? [],
        now,
      });
      if (!verdict.allowed) {
        skips.push({ event, policyId: policy.id, reason: verdict.reason });
        continue;
      }

      actions.push({ event, policyId: policy.id, action: built });
      // 한 이벤트에 여러 조치를 겹쳐 실행하지 않는다 — 첫 매칭 정책만.
      break;
    }
  }

  return { actions, skips };
}
