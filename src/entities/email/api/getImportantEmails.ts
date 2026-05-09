// 위젯 메인 read API — 7일 윈도, TOP 10, D6 답장 우선 정책 적용.
//
// SQL 핵심:
//  - JOIN email_threads (UI에 표시할 발신자/제목)
//  - LEFT JOIN reply_needed WHERE active → 매칭되면 제외 (D6)
//  - read_at·archived_at IS NULL → 처리 안 된 행만
//  - classified_at >= now - 7d → 7일 윈도
//  - ORDER BY importance, classified_at DESC → partial index 활용
import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  importantEmails,
  emailThreads,
  replyNeeded,
} from "@/shared/lib/db/schema";
import type { Category, ImportantImportance } from "../model/types";

export interface ImportantEmailItem {
  threadId: string;
  gmailThreadId: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: Date | null;
  category: Category;
  importance: ImportantImportance;
  summary: string;
  classifiedAt: Date;
}

export async function getImportantEmails(
  userId: string,
  limit = 10,
): Promise<ImportantEmailItem[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      threadId: importantEmails.threadId,
      gmailThreadId: emailThreads.gmailThreadId,
      fromName: emailThreads.lastSenderName,
      fromEmail: emailThreads.lastSenderEmail,
      subject: emailThreads.subject,
      receivedAt: emailThreads.lastReceivedAt,
      category: importantEmails.category,
      importance: importantEmails.importance,
      summary: importantEmails.summary,
      classifiedAt: importantEmails.classifiedAt,
      activeReplyThreadId: replyNeeded.threadId,
    })
    .from(importantEmails)
    .innerJoin(
      emailThreads,
      eq(importantEmails.threadId, emailThreads.id),
    )
    .leftJoin(
      replyNeeded,
      and(
        eq(replyNeeded.threadId, importantEmails.threadId),
        isNull(replyNeeded.repliedAt),
        isNull(replyNeeded.dismissedAt),
      ),
    )
    .where(
      and(
        eq(importantEmails.userId, userId),
        isNull(importantEmails.readAt),
        isNull(importantEmails.archivedAt),
        gte(importantEmails.classifiedAt, since),
        isNull(replyNeeded.threadId),
      ),
    )
    .orderBy(
      sql`CASE ${importantEmails.importance} WHEN 'high' THEN 0 ELSE 1 END`,
      desc(importantEmails.classifiedAt),
    )
    .limit(limit);

  return rows.map((r) => ({
    threadId: r.threadId,
    gmailThreadId: r.gmailThreadId,
    fromName: r.fromName,
    fromEmail: r.fromEmail,
    subject: r.subject,
    receivedAt: r.receivedAt,
    category: r.category as Category,
    importance: r.importance as ImportantImportance,
    summary: r.summary,
    classifiedAt: r.classifiedAt,
  }));
}
