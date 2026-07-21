// 수동 새로고침 결과 — client·server 공유 (이슈 #333).

/** syncGithub 결과 요약 — 버튼 피드백용. */
export interface RefreshSummary {
  issues: number;
  pulls: number;
  runs: number; // 성공 레포 수
  skipped: boolean; // 토큰 미설정
  lockBusy: boolean; // cron 과 겹쳐 이번 실행은 건너뜀
  // 부분 실패한 소스명 목록(예: ["이슈", "PR"]). 비어 있으면 전부 성공.
  // syncGithub 은 소스별 독립 수행이라 일부만 실패해도 throw 하지 않는다 —
  // 이 필드로 "갱신 완료" 오인 표시를 막는다.
  failed: string[];
}

export interface RefreshResult {
  ok: boolean;
  error?: string;
  summary?: RefreshSummary;
  cooldownSec?: number; // rate limit 걸렸을 때 남은 초
}
