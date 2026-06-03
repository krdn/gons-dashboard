import "server-only";
import { getAutopilotView } from "@/entities/autopilot-cycle/server";
import { AutopilotStatus, AutopilotMeta } from "./AutopilotStatus";
import { CycleHistoryList } from "./CycleHistoryList";
import { NextCandidates } from "./NextCandidates";

export async function AutopilotCard() {
  // 서버 RSC — TZ=Asia/Seoul. now 를 주입해 nextCycleLabel KST 계산.
  const view = await getAutopilotView(new Date());

  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4 text-[var(--color-text)]">
      <AutopilotStatus status={view.status} />
      <AutopilotMeta status={view.status} />

      <div className="mt-3 border-t border-[var(--color-hairline)] pt-3">
        <div className="mb-1.5 text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">
          사이클 이력
        </div>
        <CycleHistoryList cycles={view.cycles} />
      </div>

      <div className="mt-3 border-t border-[var(--color-hairline)] pt-3">
        <div className="mb-1.5 text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">
          다음 후보 (backlog)
        </div>
        <NextCandidates candidates={view.latestBacklog} />
      </div>
    </section>
  );
}
