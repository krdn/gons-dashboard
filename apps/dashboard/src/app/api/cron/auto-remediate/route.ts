// 5분마다 — 관제 자동 복구 사이클 (이슈 #352).
// 판정·실행 로직은 features/monitoring-remediate 에 있다.
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { runRemediationCycle } from "@/features/monitoring-remediate";

export const dynamic = "force-dynamic";

const TARGETS = [{ id: "cycle" }] as const;

export const POST = createCronHandler({
  name: "auto-remediate",
  targetSelect: async () => [...TARGETS],
  getId: (t) => t.id,
  perTarget: () => runRemediationCycle(new Date()),
});
