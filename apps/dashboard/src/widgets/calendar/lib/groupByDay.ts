import type { CalendarEvent } from "@gons/mcp-calendar";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// KST 자정 기준으로 yyyy-mm-dd 추출.
function kstDateKey(iso: string): string {
  const utcMs = new Date(iso).getTime();
  const kst = new Date(utcMs + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = pad2(kst.getUTCMonth() + 1);
  const d = pad2(kst.getUTCDate());
  return `${y}-${m}-${d}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface DayGroups {
  today: CalendarEvent[];
  tomorrow: CalendarEvent[];
}

export function groupByDay(events: CalendarEvent[], now: Date): DayGroups {
  const todayKey = kstDateKey(now.toISOString());
  const tomorrowKey = kstDateKey(new Date(now.getTime() + DAY_MS).toISOString());
  const today: CalendarEvent[] = [];
  const tomorrow: CalendarEvent[] = [];
  for (const ev of events) {
    const key = kstDateKey(ev.startAt);
    if (key === todayKey) today.push(ev);
    else if (key === tomorrowKey) tomorrow.push(ev);
  }
  return { today, tomorrow };
}
