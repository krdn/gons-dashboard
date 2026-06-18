// 받은편지함 동기화.
//
// 분기 3개:
//  1. 정상: history.list incremental → 새 메시지만 fetch
//  2. 404 historyId not found → fullRescan으로 fallback
//  3. invalid_grant → users.oauth_state='reauth_required' (auth.ts에서 이미 처리)
//
// 호출자: cron 컨테이너의 /api/cron/poll-gmail.
"use server";

import "server-only";
import { parseFromHeader } from "@krdn/email";
import { eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { emailThreads, users } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  listHistorySince,
  getMessage,
  findHeader,
  HistoryStaleError,
  InvalidGrantError,
  extractMailingListSignals,
  type MessageDetail,
} from "@/shared/api/gmail";
import { logger } from "@/shared/lib/log";
import { getEmailSettings } from "@/entities/email-settings";
import { fullRescan } from "../lib/full-rescan";
import { classifyThreadsLoop } from "../lib/classifyThreadsLoop";

export interface SyncResult {
  kind:
    | "ok-incremental"
    | "ok-full-rescan"
    | "ok-first-sync"
    | "reauth-required";
  newHistoryId?: string;
  newThreadCount?: number;
  classifiedCount?: number;
  skippedCount?: number;
}

/**
 * 사용자 1명의 inbox sync. cron 매시간 호출.
 */
export async function syncInbox(userId: string): Promise<SyncResult> {
  // 1. 유효한 access token 확보 (만료 시 auth.ts가 갱신).
  let accessToken: string;
  try {
    const tokenInfo = await getValidAccessToken(userId);
    accessToken = tokenInfo.accessToken;
  } catch (error) {
    if (error instanceof InvalidGrantError) {
      // oauth_state='reauth_required'는 getValidAccessToken에서 이미 set됨.
      return { kind: "reauth-required" };
    }
    throw error;
  }

  // 2. 사용자의 last_history_id 가져옴.
  const userRow = await db
    .select({
      lastHistoryId: users.lastHistoryId,
      ownerEmail: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userRow.length === 0) {
    throw new Error(`사용자 ${userId} 미존재`);
  }

  const { lastHistoryId, ownerEmail } = userRow[0];

  // 3. 첫 sync 또는 stale fallback.
  if (!lastHistoryId) {
    const rescan = await fullRescan(accessToken, userId);
    await persistHistoryId(userId, rescan.newHistoryId);
    // 메일링 신호는 fullRescan이 행에 영속화하고 classifyThreadsLoop가 직접 읽는다.
    const counts = await classifyAffectedThreads(userId, ownerEmail);
    return {
      kind: "ok-first-sync",
      newHistoryId: rescan.newHistoryId,
      newThreadCount: rescan.threadCount,
      classifiedCount: counts.classified,
      skippedCount: counts.skipped,
    };
  }

  // 4. Incremental polling.
  let newRefs: { id: string; threadId: string }[];
  let newHistoryId: string;
  try {
    const result = await listHistorySince(accessToken, lastHistoryId);
    newRefs = result.newMessageRefs;
    newHistoryId = result.newHistoryId;
  } catch (error) {
    if (error instanceof HistoryStaleError) {
      // history_id 폐기 → full rescan fallback.
      const rescan = await fullRescan(accessToken, userId);
      await persistHistoryId(userId, rescan.newHistoryId);
      const counts = await classifyAffectedThreads(userId, ownerEmail);
      return {
        kind: "ok-full-rescan",
        newHistoryId: rescan.newHistoryId,
        newThreadCount: rescan.threadCount,
        classifiedCount: counts.classified,
        skippedCount: counts.skipped,
      };
    }
    throw error;
  }

  // 5. 새 메시지 0개라도 historyId는 갱신.
  if (newRefs.length === 0) {
    await persistHistoryId(userId, newHistoryId);
    return {
      kind: "ok-incremental",
      newHistoryId,
      newThreadCount: 0,
      classifiedCount: 0,
      skippedCount: 0,
    };
  }

  // 6. 메시지 fetch + 스레드 단위 그룹핑 (메일링 신호는 행에 영속화됨).
  const { count: affected } = await fetchAndUpsertThreads(
    accessToken,
    userId,
    newRefs,
  );
  await persistHistoryId(userId, newHistoryId);

  // 7. 영향받은 스레드 분류 (reply_needed + important).
  // 메일링 신호는 classifyThreadsLoop가 email_threads 행에서 직접 읽는다.
  const counts = await classifyAffectedThreads(userId, ownerEmail);

  return {
    kind: "ok-incremental",
    newHistoryId,
    newThreadCount: affected,
    classifiedCount: counts.classified,
    skippedCount: counts.skipped,
  };
}

async function persistHistoryId(
  userId: string,
  historyId: string,
): Promise<void> {
  await db
    .update(users)
    .set({ lastHistoryId: historyId, lastSyncAt: new Date() })
    .where(eq(users.id, userId));
}

async function fetchAndUpsertThreads(
  accessToken: string,
  userId: string,
  refs: { id: string; threadId: string }[],
): Promise<{ count: number }> {
  // 같은 스레드의 가장 최근 메시지 1개만 보관.
  const latestPerThread = new Map<string, MessageDetail>();

  for (const ref of refs) {
    const msg = await getMessage(accessToken, ref.id);
    const existing = latestPerThread.get(ref.threadId);
    const existingTs = existing?.internalDate
      ? Number(existing.internalDate)
      : 0;
    const currentTs = msg.internalDate ? Number(msg.internalDate) : 0;
    if (!existing || currentTs > existingTs) {
      latestPerThread.set(ref.threadId, msg);
    }
  }

  for (const [gmailThreadId, msg] of latestPerThread) {
    // important 분류용 메일링 시그널 채집 → 같은 행에 영속화.
    // sync/reclassify 두 경로가 이 행을 읽어 prefilter wiring 결함을 막는다.
    const signals = extractMailingListSignals(msg.payload?.headers);

    const from = findHeader(msg.payload?.headers, "From");
    const subject = findHeader(msg.payload?.headers, "Subject");
    const internalMillis = msg.internalDate ? Number(msg.internalDate) : NaN;
    const receivedAt = Number.isFinite(internalMillis)
      ? new Date(internalMillis)
      : new Date();
    const { name, email } = parseFromHeader(from);

    await db
      .insert(emailThreads)
      .values({
        userId,
        gmailThreadId,
        subject: subject ?? null,
        lastSenderEmail: email ?? null,
        lastSenderName: name ?? null,
        lastReceivedAt: receivedAt,
        snippet: msg.snippet,
        hasListUnsubscribe: signals.hasListUnsubscribe,
        hasListId: signals.hasListId,
        precedence: signals.precedence,
      })
      .onConflictDoUpdate({
        target: [emailThreads.userId, emailThreads.gmailThreadId],
        set: {
          subject: subject ?? null,
          lastSenderEmail: email ?? null,
          lastSenderName: name ?? null,
          lastReceivedAt: receivedAt,
          snippet: msg.snippet,
          // 새 메시지 도착 시 신호도 최신 헤더로 갱신 (값/conflict 양쪽 동기 필수).
          hasListUnsubscribe: signals.hasListUnsubscribe,
          hasListId: signals.hasListId,
          precedence: signals.precedence,
          updatedAt: sql`NOW()`,
        },
      });
  }

  return { count: latestPerThread.size };
}

async function classifyAffectedThreads(
  userId: string,
  ownerEmail: string,
): Promise<{ classified: number; skipped: number }> {
  const settings = await getEmailSettings(userId);
  // 24h 윈도우. 본인 1명·일~수백통 규모에서 충분.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await classifyThreadsLoop({
    userId,
    ownerEmail,
    since,
    llmReplyEnabled: settings.llmReplyEnabled,
    llmImportantEnabled: settings.llmImportantEnabled,
  });

  if (result.importantConsidered > 0) {
    logger.info("syncInbox", "important-outcomes", {
      userId,
      ownerEmail,
      importantOutcomes: result.importantOutcomes,
    });
  }

  return { classified: result.classified, skipped: result.skipped };
}
