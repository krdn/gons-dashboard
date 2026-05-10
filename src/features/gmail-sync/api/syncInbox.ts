// 받은편지함 동기화 — eng review CRITICAL #8.
//
// 분기 3개:
//  1. 정상: history.list incremental → 새 메시지만 fetch
//  2. 404 historyId not found → fullRescan으로 fallback
//  3. invalid_grant → users.oauth_state='reauth_required' (auth.ts에서 이미 처리)
//
// 호출자: cron 컨테이너의 /api/cron/poll-gmail.
"use server";

import "server-only";
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
  type MailingListSignals,
} from "@/shared/api/gmail";
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
    // fullRescan은 시그널 Map을 반환하지 않으므로 빈 Map 전달.
    // 첫 sync 메일들은 다음 cron 사이클에서 important 분류가 자연 채워짐
    // (last_received_at > classified_at 트리거).
    const counts = await classifyAffectedThreads(userId, ownerEmail, new Map());
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
      const counts = await classifyAffectedThreads(userId, ownerEmail, new Map());
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

  // 6. 메시지 fetch + 스레드 단위 그룹핑.
  const { count: affected, signalsByGmailThread } = await fetchAndUpsertThreads(
    accessToken,
    userId,
    newRefs,
  );
  await persistHistoryId(userId, newHistoryId);

  // 7. 영향받은 스레드 분류 (reply_needed + important).
  const counts = await classifyAffectedThreads(
    userId,
    ownerEmail,
    signalsByGmailThread,
  );

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
): Promise<{
  count: number;
  signalsByGmailThread: Map<string, MailingListSignals>;
}> {
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

  const signalsByGmailThread = new Map<string, MailingListSignals>();
  for (const [gmailThreadId, msg] of latestPerThread) {
    // important 분류용 메일링 시그널 채집.
    signalsByGmailThread.set(
      gmailThreadId,
      extractMailingListSignals(msg.payload?.headers),
    );

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
      })
      .onConflictDoUpdate({
        target: [emailThreads.userId, emailThreads.gmailThreadId],
        set: {
          subject: subject ?? null,
          lastSenderEmail: email ?? null,
          lastSenderName: name ?? null,
          lastReceivedAt: receivedAt,
          snippet: msg.snippet,
          updatedAt: sql`NOW()`,
        },
      });
  }

  return { count: latestPerThread.size, signalsByGmailThread };
}

async function classifyAffectedThreads(
  userId: string,
  ownerEmail: string,
  signalsMap: Map<string, MailingListSignals> = new Map(),
): Promise<{ classified: number; skipped: number }> {
  // 24h 윈도우. 본인 1명·일~수백통 규모에서 충분.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await classifyThreadsLoop({
    userId,
    ownerEmail,
    since,
    signalsMap,
  });

  if (result.importantConsidered > 0) {
    // TODO(logger): replace with structured logger when shared/lib/log.ts is ready
    console.log(
      "[syncInbox] important-outcomes",
      JSON.stringify({
        userId,
        ownerEmail,
        importantOutcomes: result.importantOutcomes,
      }),
    );
  }

  return { classified: result.classified, skipped: result.skipped };
}

function parseFromHeader(raw?: string): { name?: string; email?: string } {
  if (!raw) return {};
  const match = raw.match(/^\s*(?:"?([^"<]+?)"?\s+)?<?([^<>\s]+@[^<>\s]+)>?\s*$/);
  if (!match) return { email: undefined, name: undefined };
  return { name: match[1]?.trim(), email: match[2]?.toLowerCase() };
}
