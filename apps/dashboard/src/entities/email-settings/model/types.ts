// Email 위젯 설정 — 타입 + 기본값 + 순수 헬퍼.
// client/server 양쪽에서 import 가능(순수 — DB·node 의존 없음).
import type { Category, Severity, ImportantImportance } from "@/entities/email/model/types";

export interface EmailSettings {
  replyNeededLimit: number;
  importantLimit: number;
  windowDays: number;
  replySeverityThreshold: Severity; // 이 이상만 표시/알림
  importantThreshold: ImportantImportance;
  categories: Category[];
  llmReplyEnabled: boolean;
  llmImportantEnabled: boolean;
  syncIntervalMinutes: number;
  digestEnabled: boolean;
  digestHourKst: number;
}

// 현재 하드코딩 값과 동일 — 미설정 사용자 동작 불변(spec 불변식).
export const EMAIL_SETTINGS_DEFAULTS: EmailSettings = {
  replyNeededLimit: 5,
  importantLimit: 10,
  windowDays: 7,
  replySeverityThreshold: "med",
  importantThreshold: "med",
  categories: ["money", "security", "schedule", "notice"],
  llmReplyEnabled: true,
  llmImportantEnabled: true,
  syncIntervalMinutes: 60,
  digestEnabled: true,
  digestHourKst: 8,
};

// severity 순위: high(0) < med(1) < low(2). 낮은 rank가 더 긴급.
const SEVERITY_RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 };

// item severity가 threshold "이상"(같거나 더 긴급)인가.
export function meetsSeverity(item: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[item] <= SEVERITY_RANK[threshold];
}

const IMPORTANCE_RANK: Record<ImportantImportance, number> = { high: 0, med: 1 };

export function meetsImportance(
  item: ImportantImportance,
  threshold: ImportantImportance,
): boolean {
  return IMPORTANCE_RANK[item] <= IMPORTANCE_RANK[threshold];
}

// 동기화 due: lastSyncAt이 없거나, now - lastSyncAt >= interval.
export function isSyncDue(
  now: Date,
  lastSyncAt: Date | null,
  intervalMinutes: number,
): boolean {
  if (!lastSyncAt) return true;
  const elapsedMs = now.getTime() - lastSyncAt.getTime();
  return elapsedMs >= intervalMinutes * 60 * 1000;
}

// 다이제스트 due: 활성 + 현재 KST 시각(hour) >= digestHourKst + 오늘 미발송.
// nowKstHour: 0-23, todayKstDate/lastSentDate: 'YYYY-MM-DD'.
export function isDigestDue(params: {
  enabled: boolean;
  nowKstHour: number;
  digestHourKst: number;
  todayKstDate: string;
  lastSentDate: string | null;
}): boolean {
  const { enabled, nowKstHour, digestHourKst, todayKstDate, lastSentDate } =
    params;
  if (!enabled) return false;
  if (nowKstHour < digestHourKst) return false;
  return lastSentDate !== todayKstDate;
}
