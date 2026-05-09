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
  type MessageDetail,
} from "@/shared/api/gmail";
import { fullRescan } from "../lib/full-rescan";
import { classifyThread, type ThreadInput } from "@/entities/email";

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
    const counts = await classifyAffectedThreads(userId, ownerEmail, rescan.threadCount);
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
      const counts = await classifyAffectedThreads(
        userId,
        ownerEmail,
        rescan.threadCount,
      );
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
  const affected = await fetchAndUpsertThreads(accessToken, userId, newRefs);
  await persistHistoryId(userId, newHistoryId);

  // 7. 영향받은 스레드 분류.
  const counts = await classifyAffectedThreads(userId, ownerEmail, affected);

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
): Promise<number> {
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

  return latestPerThread.size;
}

async function classifyAffectedThreads(
  userId: string,
  ownerEmail: string,
  expectedCount: number,
): Promise<{ classified: number; skipped: number }> {
  // 최근 sync로 영향받은 스레드들 — 단순화: 사용자의 모든 스레드 중 최근 24h.
  // (대량일 때는 비효율이지만 본인 1명·일~수백통 규모에서 충분.)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const threads = await db
    .select({
      id: emailThreads.id,
      gmailThreadId: emailThreads.gmailThreadId,
      subject: emailThreads.subject,
      lastSenderEmail: emailThreads.lastSenderEmail,
      lastSenderName: emailThreads.lastSenderName,
      snippet: emailThreads.snippet,
      lastReceivedAt: emailThreads.lastReceivedAt,
    })
    .from(emailThreads)
    .where(eq(emailThreads.userId, userId))
    .limit(expectedCount + 10);

  let classified = 0;
  let skipped = 0;

  for (const t of threads) {
    if (!t.lastReceivedAt || t.lastReceivedAt < since) {
      // 24시간 이전 스레드는 분류 재실행 안 함 (멱등성에 의존).
      continue;
    }
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
    });

    if (
      outcome.kind === "classified" ||
      outcome.kind === "fallback" ||
      outcome.kind === "user-replied"
    ) {
      classified += 1;
    } else {
      skipped += 1;
    }
  }

  return { classified, skipped };
}

function parseFromHeader(raw?: string): { name?: string; email?: string } {
  if (!raw) return {};
  const match = raw.match(/^\s*(?:"?([^"<]+?)"?\s+)?<?([^<>\s]+@[^<>\s]+)>?\s*$/);
  if (!match) return { email: undefined, name: undefined };
  return { name: match[1]?.trim(), email: match[2]?.toLowerCase() };
}
