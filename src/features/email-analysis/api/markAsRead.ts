// "읽음" 클릭 — Gmail UNREAD 라벨 제거 후 DB read_at SET.
// Gmail 우선 · DB 후행: 외부 상태 동기화 강건성. Gmail이 실패하면 DB도 변경 X.
"use server";

import "server-only";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/shared/lib/db/client";
import { auth } from "@/shared/lib/auth";
import { emailThreads, importantEmails } from "@/shared/lib/db/schema";
import { modifyThread } from "@/shared/api/gmail/modify";
import {
  GmailError,
  GmailRateLimitError,
  InvalidGrantError,
  getGmailTokenOrResult,
} from "@/shared/api/gmail";
import { logger } from "@/shared/lib/log";
import { ROUTE_DASHBOARD } from "@/shared/config/routes";

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function markAsRead(threadId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, reason: "unauthorized" };
  }
  const userId = session.user.id;

  const [thread] = await db
    .select({
      gmailThreadId: emailThreads.gmailThreadId,
    })
    .from(emailThreads)
    .where(
      and(eq(emailThreads.id, threadId), eq(emailThreads.userId, userId)),
    )
    .limit(1);

  if (!thread) {
    logger.warn("markAsRead", "not-found-or-not-owned", {
      sessionUserId: userId,
      threadId,
    });
    return { ok: false, reason: "not-found" };
  }

  const tokenResult = await getGmailTokenOrResult(userId);
  if (!tokenResult.ok) return { ok: false, reason: tokenResult.reason };
  const token = tokenResult.token;

  try {
    await modifyThread(token, thread.gmailThreadId, {
      removeLabelIds: ["UNREAD"],
    });
  } catch (err) {
    if (err instanceof GmailError && err.status === 404) {
      await db
        .update(importantEmails)
        .set({ readAt: new Date() })
        .where(eq(importantEmails.threadId, threadId));
      revalidatePath(ROUTE_DASHBOARD);
      return { ok: true };
    }
    // 진단 가시성: catch 가 reason 코드만 던지면 "gmail-error" 표면 라벨로 끝나 근본 원인 파악 불가.
    // status / googleReason / message 를 stdout JSON 으로 남겨 docker logs 에서 추적 가능하게.
    logger.error("markAsRead", "gmail-modify-failed", {
      sessionUserId: userId,
      threadId,
      gmailThreadId: thread.gmailThreadId,
      errorName: err instanceof Error ? err.name : "unknown",
      status: err instanceof GmailError ? err.status : undefined,
      googleReason: err instanceof GmailError ? err.googleReason : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof InvalidGrantError) {
      return { ok: false, reason: "reauth-required" };
    }
    if (err instanceof GmailRateLimitError) {
      return { ok: false, reason: "rate-limited" };
    }
    if (err instanceof GmailError && err.status === 401) {
      return { ok: false, reason: "unauthorized" };
    }
    if (err instanceof GmailError && err.status === 403) {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: false, reason: "gmail-error" };
  }

  await db
    .update(importantEmails)
    .set({ readAt: new Date() })
    .where(eq(importantEmails.threadId, threadId));

  revalidatePath(ROUTE_DASHBOARD);
  return { ok: true };
}
