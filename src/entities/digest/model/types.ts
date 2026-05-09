// 다중 도메인 공통 추상 — entities/digest
// 향후 widgets/calendar-digest, widgets/tasks-digest가 같은 형태를 채워서 메인 화면에 나란히 표시.

export type DigestSeverity = "high" | "med" | "low";

export interface DigestItem {
  id: string;
  title: string;
  description?: string;
  severity: DigestSeverity;
  /** 해당 도메인의 외부 링크 — Email은 mail.google.com, Calendar는 cal.google.com 등. */
  sourceUrl?: string;
  /** 마감 시각이 있는 도메인(Calendar, Tasks)에서 채움. Email은 undefined. */
  dueAt?: Date;
  /** "3시간 전" 등 상대 시간 라벨 (이미 포맷된 문자열). */
  receivedLabel?: string;
}
