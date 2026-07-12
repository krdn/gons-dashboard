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

/** 위젯 주간 라벨 — weekEnd 'YYYY-MM-DD' → 'M/D – M/D' (locale-free, Gotcha #3). */
export function formatWeekLabel(weekEnd: string): string {
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const start = new Date(end.getTime() - 6 * DAY_MS);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}
