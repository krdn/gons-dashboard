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
  GmailError,
} from "@/shared/api/gmail";
import { logger } from "@/shared/lib/log";
import { isRefusalDraft } from "@/shared/lib/llm/draft-reply";
import { validateRecipients, type RecipientField } from "../lib/validateRecipients";

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
  | { kind: "invalid-recipient"; field: RecipientField }
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

  // createDraft 직전 입력 검증 — sendReply 와 동일 가드 공유.
  const recipients = validateRecipients(meta);
  if (!recipients.ok) {
    return { kind: "invalid-recipient", field: recipients.field };
  }
  // refusal 서버 재검증 (defense-in-depth) — 초안 저장도 Gmail 에 남으므로 차단.
  if (isRefusalDraft(editedBody)) {
    logger.warn("email/saveReplyDraft", "refusal-blocked-server", { userId, threadId });
    return { kind: "save-failed" };
  }

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
    if (error instanceof GmailScopeError) {
      logger.warn("email/saveReplyDraft", "scope-required", { userId, threadId });
      return { kind: "scope-required" };
    }
    // silent swallow 방지 — #151 이 형제 sendReply 만 고쳐 누락됐던 패턴.
    // 반환 유니온 불변(UI generic 처리) — 관찰성만 보강.
    logger.error("email/saveReplyDraft", "save-failed", {
      userId,
      threadId,
      reason: error instanceof GmailError ? error.googleReason : undefined,
      status: error instanceof GmailError ? error.status : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "save-failed" };
  }
}
