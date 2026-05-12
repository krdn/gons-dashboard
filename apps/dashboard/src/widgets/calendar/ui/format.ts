// KST 기준 HH:MM 포맷 — locale 의존 없이 결정적으로 (Gotcha #3).
// Date 객체를 받아 +09:00 시각을 직접 계산 (Intl 없이).
const KST_OFFSET_MIN = 9 * 60;

export function formatHHMM(iso: string): string {
  const date = new Date(iso);
  const utcMin = date.getTime() / 1000 / 60;
  const kstMin = Math.floor(utcMin) + KST_OFFSET_MIN;
  const totalMinInDay = ((kstMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(totalMinInDay / 60);
  const m = totalMinInDay % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
