// entities/autopilot-cycle — 순수 타입.
// cycle.workflow.js 의 logEntry/debate() 반환 구조와 1:1.

export interface BacklogCandidate {
  title: string;
  score: number;
  dedupKey: string;
}

export interface DebateEntry {
  title: string;
  owner: string;
  score: number;
  changeType: string;
  dedupKey: string;
  crossReview: { challenge: string; severity: "low" | "medium" | "high"; wouldBlock: boolean }[];
  verdicts: { valueScore: number; safetyScore: number; feasibilityScore: number; reasoning: string }[];
}

export interface DebateLog {
  selected: DebateEntry | null;
  backlogTop3: DebateEntry[];
}

/** 한 사이클의 위젯 표시용 형태 (DB row → 정제). */
export interface AutopilotCycle {
  id: string; // "autopilot-2026-W24"
  isoWeek: string; // "2026-W24" — id 에서 prefix 제거
  runAt: Date;
  mode: string;
  deployFlag: "on" | "off" | null;
  candidateCount: number;
  selectedTitle: string | null;
  selectedScore: number | null;
  selectedChangeType: string | null;
  selectedOwner: string | null;
  prUrl: string | null;
  merged: boolean;
  needsHuman: boolean;
  reason: string | null;
  backlogTop3: BacklogCandidate[];
}

/** status 섹션 파생 데이터 (최신 cycle row + 서버 시각). */
export interface AutopilotStatus {
  mode: string | null; // 최신 row.mode, 없으면 null
  deployFlag: "on" | "off" | null; // 최신 row.deployFlag
  lastRunIsoWeek: string | null; // 최신 row.isoWeek, 없으면 null
  nextCycleLabel: string; // "6/9 (월)" — 서버 KST 계산
}
