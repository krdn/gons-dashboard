// entities/autopilot-cycle — 위젯 1회 호출용 조합 뷰 (이력 + 최신 backlog + status).
import "server-only";
import { getCycles } from "./getCycles";
import type { AutopilotCycle, AutopilotStatus, BacklogCandidate } from "../model/types";

/** 다음 월요일 KST "M/D (월)" 라벨. 실제 cron 요일 확정 전 표시 가정 (주 1회 월요일). */
function nextMondayLabel(now: Date): string {
  // KST 기준 계산 — 서버 RSC (TZ=Asia/Seoul).
  const day = now.getDay(); // 0=일..6=토
  const daysUntilMon = (8 - day) % 7 || 7; // 다음 월요일까지 (오늘이 월이면 +7)
  const next = new Date(now.getTime() + daysUntilMon * 86400000);
  return `${next.getMonth() + 1}/${next.getDate()} (월)`;
}

export interface AutopilotView {
  cycles: AutopilotCycle[];
  latestBacklog: BacklogCandidate[];
  status: AutopilotStatus;
}

export async function getAutopilotView(now: Date): Promise<AutopilotView> {
  const cycles = await getCycles();
  const latest = cycles[0] ?? null;
  return {
    cycles,
    latestBacklog: latest?.backlogTop3 ?? [],
    status: {
      mode: latest?.mode ?? null,
      deployFlag: latest?.deployFlag ?? null,
      lastRunIsoWeek: latest?.isoWeek ?? null,
      nextCycleLabel: nextMondayLabel(now),
    },
  };
}
