// 관제 위젯 공용 포맷터 — locale-free (Gotcha #3 hydration 안전).

/** KST HH:MM:SS — 서버 TZ 와 무관하게 결정적. */
export function formatKstTime(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3_600_000);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  const ss = String(kst.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** 상대 시각 — "12초 전" / "3분 전" / "2시간 전" / "1일 전". */
export function formatAgo(from: Date, now: Date = new Date()): string {
  const sec = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

/** 업타임 — "12일 4시간" / "3시간 12분" / "42분". */
export function formatUptime(uptimeSec: number): string {
  const min = Math.floor(uptimeSec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (day > 0) return `${day}일 ${hour % 24}시간`;
  if (hour > 0) return `${hour}시간 ${min % 60}분`;
  return `${min}분`;
}

/** bps → 사람 친화 표기 (B/s, KB/s, MB/s). */
export function formatBps(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)}MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)}KB/s`;
  return `${Math.round(bps)}B/s`;
}

/** MiB → 사람 친화 표기 (GiB 승격). */
export function formatMib(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)}GiB`;
  return `${Math.round(mib)}MiB`;
}
