// HTTP·SSL 판정 — 순수 함수 (이슈 #323 §E·F).
//
// HTTP: 단발 실패는 row status=warning 만 (이벤트 없음). 직전 결과와 합쳐
//   3연속 실패가 되는 순간 critical + 이벤트. 성공은 ok + resolve.
// SSL: D-14 warning / D-7 critical / 그 외 ok.

export const HTTP_FAIL_STREAK_FOR_CRITICAL = 3;
export const SSL_WARNING_DAYS = 14;
export const SSL_CRITICAL_DAYS = 7;

/**
 * @param currentUp 이번 프로브 성공 여부
 * @param previousStatuses 직전 결과 status — 최신순 (getRecentChecks 순서 그대로)
 */
export function judgeHttp(
  currentUp: boolean,
  previousStatuses: string[],
): "ok" | "warning" | "critical" {
  if (currentUp) return "ok";
  // 최신부터 연속된 실패(비-ok) 수 — 사이에 ok 가 끼면 streak 리셋.
  let prevFails = 0;
  for (const status of previousStatuses) {
    if (status === "ok") break;
    prevFails += 1;
  }
  return prevFails >= HTTP_FAIL_STREAK_FOR_CRITICAL - 1 ? "critical" : "warning";
}

export function judgeSsl(daysLeft: number): "ok" | "warning" | "critical" {
  if (daysLeft <= SSL_CRITICAL_DAYS) return "critical";
  if (daysLeft <= SSL_WARNING_DAYS) return "warning";
  return "ok";
}
