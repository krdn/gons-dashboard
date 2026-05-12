// KST 기준 HH:MM 포맷 — locale 의존 없이 결정적으로 (Gotcha #3).
// Date 객체를 받아 +09:00 시각을 직접 계산 (Intl 없이).
const KST_OFFSET_MIN = 9 * 60;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function formatHHMM(iso: string): string {
  const date = new Date(iso);
  const utcMin = date.getTime() / 1000 / 60;
  const kstMin = Math.floor(utcMin) + KST_OFFSET_MIN;
  const totalMinInDay = ((kstMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(totalMinInDay / 60);
  const m = totalMinInDay % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

// "오늘", "내일", "5/14 (목)" 같은 라벨을 KST 기준으로 결정적으로 생성.
// now 대비 같은 KST 날짜면 "오늘", 다음 날이면 "내일", 그 외는 "M/D (요일)".
export function formatDayLabel(iso: string, now: Date): string {
  const ev = kstYmd(iso);
  const today = kstYmd(now.toISOString());
  const tomorrow = kstYmd(new Date(now.getTime() + DAY_MS).toISOString());
  if (ev.key === today.key) return "오늘";
  if (ev.key === tomorrow.key) return "내일";
  return `${ev.month}/${ev.day} (${WEEKDAYS_KO[ev.weekday]})`;
}

function kstYmd(iso: string): {
  key: string;
  month: number;
  day: number;
  weekday: number;
} {
  const utcMs = new Date(iso).getTime();
  const kst = new Date(utcMs + KST_OFFSET_MS);
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const weekday = kst.getUTCDay();
  const key = `${kst.getUTCFullYear()}-${pad2(month)}-${pad2(day)}`;
  return { key, month, day, weekday };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
