// history_id stale 시 fallback.
//
// Gmail의 history_id는 7일+ 멈춤 후 폐기됨 → 404 historyId not found.
// 이 함수는 messages.list?q=newer_than:7d 로 최근 7일 메일을 모두 가져와서
// emailThreads upsert + 새 historyId 저장.
//
// idempotent: gmail_thread_id UNIQUE 제약으로 중복 시 스레드 메타만 갱신.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { emailThreads } from "@/shared/lib/db/schema";
import {
  listMessages,
  getMessage,
  findHeader,
  getCurrentHistoryId,
  extractMailingListSignals,
  isSkippableMessageError,
  type MailingListSignals,
} from "@/shared/api/gmail";
import { logger } from "@/shared/lib/log";
import { RESCAN_LOOKBACK_DAYS } from "./classify-window";

export interface FullRescanResult {
  newHistoryId: string;
  threadCount: number;
  messageCount: number;
}

/**
 * 최근 7일 메일을 모두 fetch + DB upsert. 새 historyId 반환.
 *
 * 호출 시점:
 *  - 첫 sync (사용자 가입 직후)
 *  - history_id stale (7일+ 멈춤 후 cron 재시작)
 *
 * 비용: messages.list 1-2회 (페이지네이션) + messages.get N회.
 *  본인 1명·일주일 ~50통 가정하면 약 50번 RPC.
 */
export async function fullRescan(
  accessToken: string,
  userId: string,
): Promise<FullRescanResult> {
  // 1. 최근 N일 메시지 ref 모두 — sent 제외 (내가 보낸 건 분류 대상 아님).
  // 적재 윈도우와 분류 윈도우는 RESCAN_LOOKBACK_DAYS 단일 출처에서 파생(감사 #5 drift 방지).
  const refs = await listMessages(
    accessToken,
    `newer_than:${RESCAN_LOOKBACK_DAYS}d -in:sent`,
  );

  // 2. 각 메시지의 헤더 + snippet fetch.
  // 스레드 단위로 그룹핑하여 마지막 메시지만 DB에 반영.
  const threadMap = new Map<
    string,
    {
      gmailMessageId: string;
      from?: string;
      subject?: string;
      receivedAt?: Date;
      snippet: string;
      signals: MailingListSignals;
    }
  >();

  for (const ref of refs) {
    let msg;
    try {
      msg = await getMessage(accessToken, ref.id);
    } catch (err) {
      // 단일 메시지 실패(404 삭제 등)는 skip하고 계속 — full-rescan은 stall에서
      // 빠져나오는 복구 경로라, poison 메시지로 전체 재스캔이 막히면 안 된다.
      if (isSkippableMessageError(err)) {
        logger.warn("gmail/fullRescan", "message-fetch-skipped", {
          userId,
          messageId: ref.id,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      throw err;
    }
    const from = findHeader(msg.payload?.headers, "From");
    const subject = findHeader(msg.payload?.headers, "Subject");
    const dateHeader = findHeader(msg.payload?.headers, "Date");

    const internalMillis = msg.internalDate ? Number(msg.internalDate) : NaN;
    const receivedAt = Number.isFinite(internalMillis)
      ? new Date(internalMillis)
      : dateHeader
        ? new Date(dateHeader)
        : new Date();

    // 같은 스레드의 더 최근 메시지로 덮어씀.
    const existing = threadMap.get(ref.threadId);
    if (
      !existing ||
      (existing.receivedAt && receivedAt > existing.receivedAt)
    ) {
      threadMap.set(ref.threadId, {
        gmailMessageId: ref.id,
        from,
        subject,
        receivedAt,
        snippet: msg.snippet,
        // 메일링 신호를 행에 영속화 (sync 경로와 동일).
        signals: extractMailingListSignals(msg.payload?.headers),
      });
    }
  }

  // 3. emailThreads upsert.
  for (const [gmailThreadId, info] of threadMap) {
    const { name, email } = parseFromHeader(info.from);
    await db
      .insert(emailThreads)
      .values({
        userId,
        gmailThreadId,
        subject: info.subject ?? null,
        lastSenderEmail: email ?? null,
        lastSenderName: name ?? null,
        lastReceivedAt: info.receivedAt ?? null,
        snippet: info.snippet,
        hasListUnsubscribe: info.signals.hasListUnsubscribe,
        hasListId: info.signals.hasListId,
        precedence: info.signals.precedence,
      })
      .onConflictDoUpdate({
        target: [emailThreads.userId, emailThreads.gmailThreadId],
        set: {
          subject: info.subject ?? null,
          lastSenderEmail: email ?? null,
          lastSenderName: name ?? null,
          lastReceivedAt: info.receivedAt ?? null,
          snippet: info.snippet,
          hasListUnsubscribe: info.signals.hasListUnsubscribe,
          hasListId: info.signals.hasListId,
          precedence: info.signals.precedence,
          updatedAt: sql`NOW()`,
        },
      });
  }

  // 4. 새 historyId 가져오기 (다음 incremental polling 시작점).
  const newHistoryId = await getCurrentHistoryId(accessToken);

  return {
    newHistoryId,
    threadCount: threadMap.size,
    messageCount: refs.length,
  };
}

/**
 * "Hong Gildong <hong@example.com>" → { name, email }
 */
function parseFromHeader(
  raw?: string,
): { name?: string; email?: string } {
  if (!raw) return {};
  const match = raw.match(/^\s*(?:"?([^"<]+?)"?\s+)?<?([^<>\s]+@[^<>\s]+)>?\s*$/);
  if (!match) return { email: undefined, name: undefined };
  return { name: match[1]?.trim(), email: match[2]?.toLowerCase() };
}

export const __INTERNAL = { parseFromHeader };
