// 위젯 메인 read API — opts(윈도·limit·카테고리·importance) 주입, D6 답장 우선 정책 적용.
// 기본값은 기존 동작 보존(7일 윈도, TOP 10, importance 필터 없음, 전체 카테고리).
//
// SQL 핵심:
//  - JOIN email_threads (UI에 표시할 발신자/제목)
//  - LEFT JOIN reply_needed WHERE active → 매칭되면 제외 (D6)
//  - read_at·archived_at IS NULL → 처리 안 된 행만
//  - classified_at >= now - windowDays → 설정 윈도
//  - 카테고리·importance 필터는 SQL WHERE에서 적용 → LIMIT이 출력 크기를 정확히 제한
//  - ORDER BY importance, classified_at DESC → partial index 활용
import "server-only";
import { and, asc, desc, eq, gte, isNull, inArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  importantEmails,
  emailThreads,
  replyNeeded,
} from "@/shared/lib/db/schema";
import type { Category, ImportantImportance, ImportantEmailItem } from "../model/types";

export type { ImportantEmailItem };

export interface GetImportantEmailsOpts {
  limit?: number;
  windowDays?: number;
  importanceThreshold?: ImportantImportance; // "high" | "med"
  categories?: Category[];
}

// importance 순위: high(0) < med(1). 낮을수록 긴급.
const IMPORTANCE_RANK: Record<ImportantImportance, number> = { high: 0, med: 1 };
const ALL_CATEGORIES: Category[] = ["money", "security", "schedule", "notice"];

export async function getImportantEmails(
  userId: string,
  opts?: GetImportantEmailsOpts,
): Promise<ImportantEmailItem[]> {
  const limit = opts?.limit ?? 10;
  const windowDays = opts?.windowDays ?? 7;
  const importanceThreshold = opts?.importanceThreshold ?? "med"; // med = 둘 다 포함(필터 없음)
  const categories = opts?.categories ?? ALL_CATEGORIES;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const thresholdRank = IMPORTANCE_RANK[importanceThreshold];
  const allowedImportances = (["high", "med"] as const).filter(
    (i) => IMPORTANCE_RANK[i] <= thresholdRank,
  );

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
        // 카테고리 필터 — 설정에서 선택한 카테고리만. 빈 배열이면 결과 0(모두 끔).
        inArray(importantEmails.category, categories),
        // importance 임계값 — SQL WHERE에서 필터해 LIMIT이 출력 크기를 정확히 제한.
        inArray(importantEmails.importance, allowedImportances),
      ),
    )
    .orderBy(
      // 'high' < 'med' lexicographic — partial index (importance, classified_at DESC) 활용.
      asc(importantEmails.importance),
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
