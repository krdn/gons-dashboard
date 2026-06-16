// 답장 필요 read API — entities/email
// 다른 위젯·feature가 자유롭게 import (FSD 의존 방향에서 entities는 widgets/features 양쪽에서 import 가능).
//
// 메인 쿼리: replied_at IS NULL AND dismissed_at IS NULL
//            AND classified_at >= (NOW(KST) - windowDays)
// 인덱스: reply_needed_open_idx (partial index, eng review D10)
//
// 윈도우 정의: "오늘"이 아니라 최근 windowDays일(기본 7) rolling window. classified_at은
// timestamptz로 저장되어 AT TIME ZONE 'Asia/Seoul'로 변환 후 windowDays 인터벌과 비교.
// (위젯 라벨도 "답장 필요"로 표기 — 누적 미답장 목록이지 당일 분류분이 아님.)
import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
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

export interface GetReplyNeededOpts {
  limit?: number;
  windowDays?: number;
  severityThreshold?: "high" | "med" | "low";
}

// severity 순위: high(0) < med(1) < low(2). 낮을수록 긴급.
const SEVERITY_RANK: Record<"high" | "med" | "low", number> = {
  high: 0,
  med: 1,
  low: 2,
};

/**
 * 사용자의 reply_needed TOP N (severity DESC, classified_at DESC).
 * limit/window/severity 임계값은 호출자(위젯·cron)가 email_settings에서 읽어 주입.
 * 미지정 시 기존 기본값(limit 5, window 7, threshold low=필터 없음)으로 동작.
 *
 * @param userId 사용자 UUID
 * @param opts limit/windowDays/severityThreshold (설정 주입). FSD entities→entities 회피.
 */
export async function getReplyNeeded(
  userId: string,
  opts?: GetReplyNeededOpts,
): Promise<ReplyNeededItem[]> {
  const limit = opts?.limit ?? 5;
  const windowDays = opts?.windowDays ?? 7;
  const severityThreshold = opts?.severityThreshold ?? "low"; // low = 필터 없음

  // 임계값 이상(rank ≤) severity만 SQL에서 필터 — LIMIT이 필터 이후에 적용되도록.
  // (post-query filter는 LIMIT으로 잘린 행을 다시 버려 truncation 버그를 유발.)
  const thresholdRank = SEVERITY_RANK[severityThreshold];
  const allowedSeverities = (["high", "med", "low"] as const).filter(
    (s) => SEVERITY_RANK[s] <= thresholdRank,
  );

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
        // 설정 윈도우(windowDays) — KST 기준.
        gte(
          replyNeeded.classifiedAt,
          sql`(NOW() AT TIME ZONE 'Asia/Seoul' - (${windowDays} || ' days')::interval)::timestamp`,
        ),
        // severity 임계값 — WHERE에서 필터해 LIMIT이 필터 이후 적용되게.
        inArray(replyNeeded.severity, allowedSeverities),
      ),
    )
    .orderBy(
      sql`CASE ${replyNeeded.severity} WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END`,
      desc(replyNeeded.classifiedAt),
    )
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    severity: r.severity as ReplyNeededItem["severity"],
  }));
}
