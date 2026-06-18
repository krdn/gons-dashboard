// 수동 재분류 — 검증/복구용.
//
// syncInbox는 Gmail history.list 결과 새 메시지가 0개면 분류 분기 자체를 skip한다
// (last_history_id 보전 멱등성). 그 결과 모델 업그레이드/프롬프트 변경 등의
// 재분류 시나리오에서 hourly cron만 기다리면 자연 검증이 안 되는 사각이 생긴다.
//
// 이 함수는:
//   - last_history_id를 건드리지 않고 (Gmail 동기화는 분리)
//   - hoursBack 윈도우 안의 user 스레드에 대해
//   - force=true면 important_emails(해당 user×윈도우)를 먼저 비우고
//   - classifyThreadsLoop로 reply_needed + important 1사이클 재실행한다.
//
// 보안: 라우트 레이어에서 인증, 본 함수는 userId 신뢰. ownerEmail은 users 테이블에서 lookup.
import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  users,
  emailThreads,
  importantEmails,
} from "@/shared/lib/db/schema";
import { logger } from "@/shared/lib/log";
import { getEmailSettings } from "@/entities/email-settings";
import {
  getValidAccessToken,
  getThread,
  extractMailingListSignals,
  isSignalRowUnpopulated,
} from "@/shared/api/gmail";
import { classifyThreadsLoop } from "../lib/classifyThreadsLoop";

export interface ReclassifyRecentParams {
  userId: string;
  hoursBack: number;
  force: boolean;
}

export interface ReclassifyRecentResult {
  kind: "ok" | "user-not-found";
  email?: string;
  windowFrom?: string;
  threadsInWindow?: number;
  forcedDeleted?: number;
  signalsBackfilled?: number;
  classified?: number;
  skipped?: number;
  importantOutcomes?: Record<string, number>;
  importantConsidered?: number;
}

const MAX_THREADS = 500;

export async function reclassifyRecent(
  params: ReclassifyRecentParams,
): Promise<ReclassifyRecentResult> {
  const { userId, hoursBack, force } = params;

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { kind: "user-not-found" };

  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  const windowThreads = await db
    .select({
      id: emailThreads.id,
      gmailThreadId: emailThreads.gmailThreadId,
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
    )
    .limit(MAX_THREADS);

  // 메일링 신호가 미채집(NULL)인 행을 Gmail에서 lazy 재채집해 영속화.
  // 마이그레이션 이전에 sync된 행은 신호가 없어 메일링리스트 컷이 우회되므로,
  // reclassify가 대상 행의 신호를 한 번 채워야 prefilter가 그 행에도 적용된다.
  const backfilled = await backfillMissingSignals(userId, windowThreads);

  let forcedDeleted = 0;
  if (force && windowThreads.length > 0) {
    const ids = windowThreads.map((t) => t.id);
    const deleted = await db
      .delete(importantEmails)
      .where(
        and(
          eq(importantEmails.userId, userId),
          inArray(importantEmails.threadId, ids),
        ),
      )
      .returning({ threadId: importantEmails.threadId });
    forcedDeleted = deleted.length;
  }

  const settings = await getEmailSettings(userId);

  const result = await classifyThreadsLoop({
    userId,
    ownerEmail: user.email,
    since,
    maxThreads: MAX_THREADS,
    llmReplyEnabled: settings.llmReplyEnabled,
    llmImportantEnabled: settings.llmImportantEnabled,
  });

  // 재분류는 본질적으로 진단/검증 — 항상 outcome 분포 로깅.
  logger.info("reclassifyRecent", "outcomes", {
    userId,
    email: user.email,
    hoursBack,
    force,
    forcedDeleted,
    signalsBackfilled: backfilled,
    threadsInWindow: windowThreads.length,
    importantOutcomes: result.importantOutcomes,
  });

  return {
    kind: "ok",
    email: user.email,
    windowFrom: since.toISOString(),
    threadsInWindow: windowThreads.length,
    forcedDeleted,
    signalsBackfilled: backfilled,
    classified: result.classified,
    skipped: result.skipped,
    importantOutcomes: result.importantOutcomes,
    importantConsidered: result.importantConsidered,
  };
}

/**
 * 신호 컬럼이 미채집(전부 NULL)인 행을 Gmail에서 재채집해 영속화.
 * getThread(format=full)는 metadata 화이트리스트 제약 없이 모든 헤더를 받으므로
 * List-Unsubscribe/List-ID/Precedence를 확실히 확보한다.
 * 개별 thread fetch 실패는 skip(다음 reclassify·sync가 재시도) — 전체를 죽이지 않는다.
 *
 * @returns 실제로 신호를 채운 행 수
 */
async function backfillMissingSignals(
  userId: string,
  rows: {
    id: string;
    gmailThreadId: string;
    hasListUnsubscribe: boolean | null;
    hasListId: boolean | null;
    precedence: string | null;
  }[],
): Promise<number> {
  const stale = rows.filter((r) =>
    isSignalRowUnpopulated({
      hasListUnsubscribe: r.hasListUnsubscribe,
      hasListId: r.hasListId,
      precedence: r.precedence,
      fromHeader: null,
    }),
  );
  if (stale.length === 0) return 0;

  let accessToken: string;
  try {
    accessToken = (await getValidAccessToken(userId)).accessToken;
  } catch {
    // 토큰 확보 실패 시 backfill skip — 재분류 자체는 (빈 신호로) 진행.
    return 0;
  }

  let filled = 0;
  for (const row of stale) {
    try {
      const thread = await getThread(accessToken, row.gmailThreadId);
      const last = thread.messages.at(-1);
      const signals = extractMailingListSignals(last?.payload?.headers);
      await db
        .update(emailThreads)
        .set({
          hasListUnsubscribe: signals.hasListUnsubscribe,
          hasListId: signals.hasListId,
          precedence: signals.precedence,
        })
        .where(eq(emailThreads.id, row.id));
      filled += 1;
    } catch (err) {
      logger.warn("reclassifyRecent", "signal-backfill-failed", {
        threadId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return filled;
}
