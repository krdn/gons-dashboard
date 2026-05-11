// "보관" 클릭 — Gmail INBOX 라벨 제거 후 DB archived_at SET.
// 404 (메시지 사라짐) → archived_at SET으로 정리 (DB만 동기화).
"use server";

import "server-only";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/shared/lib/db/client";
import { auth } from "@/shared/lib/auth";
import { emailThreads, importantEmails } from "@/shared/lib/db/schema";
import { modifyThread } from "@/shared/api/gmail/modify";
import { getValidAccessToken } from "@/shared/api/gmail/auth";
import { GmailError, InvalidGrantError } from "@/shared/api/gmail";
import { logger } from "@/shared/lib/log";
import { ROUTE_DASHBOARD } from "@/shared/config/routes";
import type { ActionResult } from "./markAsRead";

export async function archiveThread(threadId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, reason: "unauthorized" };
  }
  const userId = session.user.id;

  const [thread] = await db
    .select({ gmailThreadId: emailThreads.gmailThreadId })
    .from(emailThreads)
    .where(
      and(eq(emailThreads.id, threadId), eq(emailThreads.userId, userId)),
    )
    .limit(1);

  if (!thread) {
    logger.warn("archiveThread", "not-found-or-not-owned", {
      sessionUserId: userId,
      threadId,
    });
    return { ok: false, reason: "not-found" };
  }

  let token: string;
  try {
    token = (await getValidAccessToken(userId)).accessToken;
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      return { ok: false, reason: "reauth-required" };
    }
    return { ok: false, reason: "auth-error" };
  }

  try {
    await modifyThread(token, thread.gmailThreadId, {
      removeLabelIds: ["INBOX"],
    });
  } catch (err) {
    if (err instanceof GmailError && err.status === 404) {
      await db
        .update(importantEmails)
        .set({ archivedAt: new Date() })
        .where(eq(importantEmails.threadId, threadId));
      revalidatePath(ROUTE_DASHBOARD);
      return { ok: true };
    }
    return { ok: false, reason: "gmail-error" };
  }

  await db
    .update(importantEmails)
    .set({ archivedAt: new Date() })
    .where(eq(importantEmails.threadId, threadId));

  revalidatePath(ROUTE_DASHBOARD);
  return { ok: true };
}
