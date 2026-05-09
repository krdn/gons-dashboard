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
import { getValidAccessToken } from "@/shared/api/gmail/auth";
import { GmailError, InvalidGrantError } from "@/shared/api/gmail";

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
    // TODO(logger): replace with structured logger when shared/lib/log.ts is ready
    console.warn("[markAsRead] not-found-or-not-owned", {
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
      removeLabelIds: ["UNREAD"],
    });
  } catch (err) {
    if (err instanceof GmailError && err.status === 404) {
      await db
        .update(importantEmails)
        .set({ readAt: new Date() })
        .where(eq(importantEmails.threadId, threadId));
      revalidatePath("/dashboard");
      return { ok: true };
    }
    return { ok: false, reason: "gmail-error" };
  }

  await db
    .update(importantEmails)
    .set({ readAt: new Date() })
    .where(eq(importantEmails.threadId, threadId));

  revalidatePath("/dashboard");
  return { ok: true };
}
