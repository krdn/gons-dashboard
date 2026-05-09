// 답장 필요 read API — entities/email
// 다른 위젯·feature가 자유롭게 import (FSD 의존 방향에서 entities는 widgets/features 양쪽에서 import 가능).
//
// 메인 쿼리: replied_at IS NULL AND dismissed_at IS NULL AND classified_at >= today_kst
// 인덱스: reply_needed_open_idx (partial index, eng review D10)
//
// "오늘"의 정의: KST 자정 기준. classified_at은 timestamptz로 저장되어
// AT TIME ZONE 'Asia/Seoul'로 변환 후 비교.
import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { replyNeeded, emailThreads } from "@/shared/lib/db/schema";

export interface ReplyNeededItem {
  threadId: string;
  gmailThreadId: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: Date | null;
  reason: string;
  severity: "high" | "med" | "low";
  classifiedAt: Date;
  classifiedBy: string;
}

/**
 * 사용자의 "오늘" reply_needed TOP N (severity DESC, classified_at DESC).
 *
 * @param userId 사용자 UUID
 * @param limit 기본 5 (메인 디지스트), 더 보고 싶으면 페이지에서 추가 호출.
 */
export async function getReplyNeeded(
  userId: string,
  limit = 5,
): Promise<ReplyNeededItem[]> {
  // KST 오늘 자정. timestamp without timezone으로 비교.
  // (classified_at도 timestamp without timezone, KST 가정 — TZ=Asia/Seoul ENV 강제)
  const todayKstStart = sql<Date>`(NOW() AT TIME ZONE 'Asia/Seoul')::date`;

  const rows = await db
    .select({
      threadId: replyNeeded.threadId,
      gmailThreadId: emailThreads.gmailThreadId,
      fromName: emailThreads.lastSenderName,
      fromEmail: emailThreads.lastSenderEmail,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      receivedAt: emailThreads.lastReceivedAt,
      reason: replyNeeded.reason,
      severity: replyNeeded.severity,
      classifiedAt: replyNeeded.classifiedAt,
      classifiedBy: replyNeeded.classifiedBy,
    })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .where(
      and(
        eq(replyNeeded.userId, userId),
        isNull(replyNeeded.repliedAt),
        isNull(replyNeeded.dismissedAt),
        // 분류된 지 오래된 것은 제외 — "오늘 분류" 또는 "최근 7일" 정책.
        // 너무 빡빡하면 빈 화면, 너무 느슨하면 오래된 메일이 끼어듦.
        // v0.1: 최근 7일 (todayKst - 7).
        gte(
          replyNeeded.classifiedAt,
          sql`(NOW() AT TIME ZONE 'Asia/Seoul' - INTERVAL '7 days')::timestamp`,
        ),
      ),
    )
    .orderBy(
      sql`CASE ${replyNeeded.severity} WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END`,
      desc(replyNeeded.classifiedAt),
    )
    .limit(limit);

  // todayKstStart는 SQL fragment 비교용 보조 — 위 쿼리에서 직접 안 씀.
  void todayKstStart;

  return rows.map((r) => ({
    ...r,
    severity: r.severity as ReplyNeededItem["severity"],
  }));
}
