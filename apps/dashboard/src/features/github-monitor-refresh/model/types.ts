// 수동 새로고침 결과 — client·server 공유 (이슈 #333).

/** syncGithub 결과 요약 — 버튼 피드백용. */
export interface RefreshSummary {
  issues: number;
  pulls: number;
  runs: number; // 성공 레포 수
  skipped: boolean; // 토큰 미설정
  lockBusy: boolean; // cron 과 겹쳐 이번 실행은 건너뜀
}

export interface RefreshResult {
  ok: boolean;
  error?: string;
  summary?: RefreshSummary;
  cooldownSec?: number; // rate limit 걸렸을 때 남은 초
}
