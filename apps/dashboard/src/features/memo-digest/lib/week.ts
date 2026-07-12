// 다이제스트 주차 산술 — KST 고정 UTC+9 (DST 없음이라 +9h 산술 안전, kstTodayDate 전례).
//
// 창 = [직전 일요일 19:00 KST, 대상 일요일 19:00 KST) — 연속 주가 빈틈·중복 없이
// 타일링. "대상 일요일" = 19:00이 이미 지난 가장 최근 일요일 (일요일 19:00 전이면
// 지난주 일요일 → 월요일 catchup도 같은 창을 계산한다).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_HOUR_KST = 19;

export interface DigestWindow {
  /** 창을 닫는 일요일의 KST 날짜 'YYYY-MM-DD' — memo_digests 멱등 키. */
  weekEnd: string;
  /** UTC 시각 — 직전 일요일 19:00 KST (inclusive). */
  from: Date;
  /** UTC 시각 — 대상 일요일 19:00 KST (exclusive). */
  to: Date;
}

export function computeDigestWindow(now: Date): DigestWindow {
  // UTC 게터로 KST 필드를 읽는 가상 시각.
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dow = kst.getUTCDay(); // 0=일
  let daysSinceSunday = dow;
  if (dow === 0 && kst.getUTCHours() < DIGEST_HOUR_KST) daysSinceSunday = 7;

  const sundayMidnightKstMs =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
    daysSinceSunday * DAY_MS;
  const toKstMs = sundayMidnightKstMs + DIGEST_HOUR_KST * 60 * 60 * 1000;

  return {
    weekEnd: new Date(sundayMidnightKstMs).toISOString().slice(0, 10),
    from: new Date(toKstMs - 7 * DAY_MS - KST_OFFSET_MS),
    to: new Date(toKstMs - KST_OFFSET_MS),
  };
}

/** weekEnd('YYYY-MM-DD', 일요일)에서 창 복원 — computeDigestWindow와 동일 경계 (백필용). */
export function windowForWeekEnd(weekEnd: string): DigestWindow {
  const sundayMidnightKstMs = Date.parse(`${weekEnd}T00:00:00Z`);
  const toKstMs = sundayMidnightKstMs + DIGEST_HOUR_KST * 60 * 60 * 1000;
  return {
    weekEnd,
    from: new Date(toKstMs - 7 * DAY_MS - KST_OFFSET_MS),
    to: new Date(toKstMs - KST_OFFSET_MS),
  };
}

// 열거 자체의 병적 상한 (10년) — 손상된 week_end 데이터로 인한 무한 루프 가드.
const MAX_ENUMERATION_WEEKS = 520;

/**
 * 마지막 기록 주(lastWeekEnd, exclusive) 이후 누락된 weekEnd 열거 — 오래된 순,
 * 한 실행당 최대 maxWeeks개. 실패(LLM 장애·컨테이너 다운)가 한 주를 넘겨도 창이
 * 영구 누락되지 않게 하는 백필 경로.
 *
 * ⚠️ 반드시 "오래된 순"으로 잘라야 한다 — 최신 우선 컷은 커서(getLatestDigest =
 * max week_end)가 배치 처리 후 구멍을 건너뛰어, maxWeeks보다 긴 공백의 나머지
 * 주가 영구 스킵된다 (Codex 리뷰 확정 결함). 오래된 순이면 잔여 주를 다음
 * 실행(매일 19:05)이 이어서 소진한다.
 *
 * lastWeekEnd=null(첫 다이제스트)은 현재 주만 반환 (신규 사용자 백필 스팸 방지).
 */
export function enumerateMissingWeekEnds(
  lastWeekEnd: string | null,
  currentWeekEnd: string,
  maxWeeks: number,
): string[] {
  if (lastWeekEnd === null) return [currentWeekEnd];
  const currentMs = Date.parse(`${currentWeekEnd}T00:00:00Z`);
  const missing: string[] = [];
  for (let i = 0; i < MAX_ENUMERATION_WEEKS; i += 1) {
    const weekEnd = new Date(currentMs - i * 7 * DAY_MS).toISOString().slice(0, 10);
    if (weekEnd <= lastWeekEnd) break;
    missing.push(weekEnd);
  }
  return missing.reverse().slice(0, maxWeeks);
}

/** 위젯 주간 라벨 — weekEnd 'YYYY-MM-DD' → 'M/D – M/D' (locale-free, Gotcha #3). */
export function formatWeekLabel(weekEnd: string): string {
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const start = new Date(end.getTime() - 6 * DAY_MS);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}
