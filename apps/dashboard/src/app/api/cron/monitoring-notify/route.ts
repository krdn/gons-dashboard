// 매분 — 관제 critical 알림 sweep (이슈 #323 §K, Phase 1 잔여).
// 발생/회복 두 단계를 target 으로 분리 — 한쪽 실패가 다른 쪽을 막지 않는다.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import {
  notifyOpenCriticals,
  notifyResolvedCriticals,
} from "@/features/monitoring-notify";

export const dynamic = "force-dynamic";

const TARGETS = [{ id: "open-critical" }, { id: "resolved-critical" }] as const;

export const POST = createCronHandler({
  name: "monitoring-notify",
  targetSelect: async () => [...TARGETS],
  getId: (t) => t.id,
  perTarget: (t) =>
    t.id === "open-critical" ? notifyOpenCriticals() : notifyResolvedCriticals(),
});
