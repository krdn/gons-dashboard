// 액션 추출 도메인 날짜 헬퍼 — 전부 locale-free (hydration mismatch 방지, Gotcha #3).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * LLM 프롬프트용 현재 KST 일시 라벨 — "2026-07-12 (일) 23:20".
 * 상대 날짜("다음 주 화요일") 해석의 기준점으로 프롬프트에 주입 (스펙 §3).
 * 서버 TZ와 무관하게 +9h 산술로 고정 (KST는 DST 없음).
 */
export function formatKstNowLabel(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} (${DAY_NAMES[kst.getUTCDay()]}) ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}

/**
 * 패널 기한 라벨 — "7/15(화) 14:00" / allDay면 "7/15(화)".
 * 클라이언트 로컬 게터 사용 (브라우저 KST — MemoCard.formatTime 전례).
 */
export function formatDueLabel(due: Date, allDay: boolean): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${due.getMonth() + 1}/${due.getDate()}(${DAY_NAMES[due.getDay()]})`;
  return allDay ? datePart : `${datePart} ${pad(due.getHours())}:${pad(due.getMinutes())}`;
}

/** LLM이 낸 ISO 문자열 → Date. 파싱 실패는 null로 강등 — 제안 자체는 유지 (스펙 §3). */
export function parseDueAtIso(iso: string | null): Date | null {
  if (iso === null || iso.trim() === "") return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
