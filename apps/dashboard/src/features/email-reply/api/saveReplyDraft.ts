// 편집된 답장 본문 → Gmail 초안 저장. DB 무저장.
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailThreads, replyNeeded } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  createDraft,
  GmailScopeError,
} from "@/shared/api/gmail";

export interface SaveDraftMeta {
  gmailThreadId: string;
  toEmail: string;
  subject: string;
  inReplyTo: string;
  references: string;
  cc?: string;
  bcc?: string;
}

export type SaveReplyResult =
  | { kind: "ok"; draftId: string }
  | { kind: "scope-required" }
  | { kind: "save-failed" };

export async function saveReplyDraft(
  threadId: string,
  editedBody: string,
  meta: SaveDraftMeta,
): Promise<SaveReplyResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // 소유권 재확인 (meta는 클라이언트에서 왔으므로 threadId 기준으로 검증).
  const owned = await db
    .select({ gmailThreadId: emailThreads.gmailThreadId })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .where(and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)))
    .limit(1);

  if (owned.length === 0) throw new Error("Thread not found");
  // gmailThreadId는 DB 값을 신뢰 (meta 위변조 방지).
  const gmailThreadId = owned[0].gmailThreadId;

  const { accessToken } = await getValidAccessToken(userId);

  try {
    const result = await createDraft(accessToken, {
      gmailThreadId,
      toEmail: meta.toEmail,
      subject: meta.subject,
      inReplyTo: meta.inReplyTo,
      references: meta.references,
      cc: meta.cc,
      bcc: meta.bcc,
      body: editedBody,
    });
    return { kind: "ok", draftId: result.draftId };
  } catch (error) {
    if (error instanceof GmailScopeError) return { kind: "scope-required" };
    return { kind: "save-failed" };
  }
}
