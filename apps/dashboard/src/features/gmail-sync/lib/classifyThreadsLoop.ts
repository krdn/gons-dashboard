// 24h 윈도우 스레드 분류 루프 — syncInbox와 reclassifyRecent가 공유.
//
// syncInbox는 history-driven으로 새 메시지가 있을 때만 호출되고,
// reclassifyRecent는 수동 트리거로 last_history_id와 무관하게 24h(또는 hoursBack)
// 스레드를 다시 돌려 검증/복구한다.
//
// 멱등성: classifyThread는 onConflictDoUpdate, classifyImportantThread는
// last_received_at <= classified_at이면 skipped-already 반환. force=true이면
// 호출자(reclassifyRecent)가 사전에 important_emails 행을 비워두고 들어온다.
import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { logger } from "@/shared/lib/log";
import { emailThreads } from "@/shared/lib/db/schema";
import {
  classifyThread,
  classifyImportantThread,
  type ThreadInput,
} from "@/entities/email";
import { rowToSignals } from "@/shared/api/gmail";

export interface ClassifyLoopResult {
  classified: number;
  skipped: number;
  importantOutcomes: Record<string, number>;
  importantConsidered: number;
}

export interface ClassifyLoopParams {
  userId: string;
  ownerEmail: string;
  since: Date;
  // SQL-level 캡 — 안전 한도. reclassifyRecent에서만 의미.
  maxThreads?: number;
  /** LLM 분류 on/off(설정 반영). 미지정 시 둘 다 true. */
  llmReplyEnabled?: boolean;
  llmImportantEnabled?: boolean;
}

/**
 * 사용자의 last_received_at >= since 스레드 전부에 대해
 * reply_needed + important 분류를 1사이클 실행.
 *
 * since는 호출자가 결정 (syncInbox: 24h, reclassifyRecent: hoursBack 시간 전).
 */
export async function classifyThreadsLoop(
  params: ClassifyLoopParams,
): Promise<ClassifyLoopResult> {
  const {
    userId,
    ownerEmail,
    since,
    maxThreads,
    llmReplyEnabled = true,
    llmImportantEnabled = true,
  } = params;

  const baseQuery = db
    .select({
      id: emailThreads.id,
      gmailThreadId: emailThreads.gmailThreadId,
      subject: emailThreads.subject,
      lastSenderEmail: emailThreads.lastSenderEmail,
      lastSenderName: emailThreads.lastSenderName,
      snippet: emailThreads.snippet,
      lastReceivedAt: emailThreads.lastReceivedAt,
      // 영속화된 메일링리스트 신호 — sync/reclassify 동일 출처.
      hasListUnsubscribe: emailThreads.hasListUnsubscribe,
      hasListId: emailThreads.hasListId,
      precedence: emailThreads.precedence,
    })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        gte(emailThreads.lastReceivedAt, since),
      ),
    );

  const threads =
    typeof maxThreads === "number" ? await baseQuery.limit(maxThreads) : await baseQuery;

  let classified = 0;
  let skipped = 0;
  const importantOutcomes: Record<string, number> = {};
  let importantConsidered = 0;

  for (const t of threads) {
    if (!t.lastReceivedAt) continue;

    const input: ThreadInput = {
      threadId: t.gmailThreadId,
      lastSenderEmail: (t.lastSenderEmail ?? "").toLowerCase(),
      lastSenderName: t.lastSenderName ?? undefined,
      subject: t.subject ?? "",
      snippet: t.snippet ?? "",
      receivedAt: t.lastReceivedAt,
      ownerEmail,
      lastSenderIsOwner:
        (t.lastSenderEmail ?? "").toLowerCase() === ownerEmail.toLowerCase(),
    };

    const outcome = await classifyThread({
      userId,
      threadId: t.id,
      input,
      useLlm: llmReplyEnabled,
    });

    // 행에 영속화된 신호를 직접 사용 — sync/reclassify 양쪽 동일 출처.
    // (reclassifyRecent가 사전에 NULL 신호 행을 lazy 재채집해 채워둠.)
    const signals = rowToSignals({
      hasListUnsubscribe: t.hasListUnsubscribe,
      hasListId: t.hasListId,
      precedence: t.precedence,
      fromHeader: (t.lastSenderEmail ?? "").toLowerCase() || null,
    });
    try {
      const impOutcome = await classifyImportantThread({
        userId,
        threadId: t.id,
        input: {
          subject: t.subject ?? "",
          fromName: t.lastSenderName ?? null,
          fromEmail: (t.lastSenderEmail ?? "").toLowerCase(),
          snippet: t.snippet ?? "",
          receivedAtKst: formatKst(t.lastReceivedAt),
        },
        signals,
        useLlm: llmImportantEnabled,
      });
      importantOutcomes[impOutcome.kind] =
        (importantOutcomes[impOutcome.kind] ?? 0) + 1;
      importantConsidered += 1;
    } catch (err) {
      logger.warn("gmail/classifyThreadsLoop", "important-classify-failed", {
        threadId: t.id,
        message: err instanceof Error ? err.message : String(err),
      });
      importantOutcomes["throw"] = (importantOutcomes["throw"] ?? 0) + 1;
      importantConsidered += 1;
    }

    if (
      outcome.kind === "classified" ||
      outcome.kind === "fallback" ||
      outcome.kind === "user-replied"
    ) {
      classified += 1;
      // reply LLM 강등 관측 — fallback은 게이트웨이 down 등으로 deterministic으로
      // 떨어진 것. classified 카운트에 묻히면 게이트웨이 전면 장애가 무징후라
      // 호출당 1줄 warn으로 노출 (important 트랙 importantOutcomes와 대칭).
      if (outcome.kind === "fallback") {
        logger.warn("gmail/classifyThreadsLoop", "reply-llm-degraded", {
          threadId: t.id,
          reason: outcome.reason,
        });
      }
    } else {
      skipped += 1;
    }
  }

  return { classified, skipped, importantOutcomes, importantConsidered };
}

function formatKst(date: Date): string {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${fmt.format(date)} KST`;
}
