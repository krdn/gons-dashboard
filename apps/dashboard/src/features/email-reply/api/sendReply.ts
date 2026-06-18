// 편집된 답장 본문 → Gmail 초안 생성 후 즉시 발송. DB 무저장.
// createDraft → sendDraft 2-step (기존 draft 인프라 재사용).
// 소유권은 DB의 gmailThreadId 로 재검증 (클라이언트 meta 불신).
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailThreads, replyNeeded } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  createDraft,
  sendDraft,
  GmailScopeError,
  GmailError,
} from "@/shared/api/gmail";
import { logger } from "@/shared/lib/log";
import type { SaveDraftMeta } from "./saveReplyDraft";

export type SendReplyResult =
  | { kind: "ok"; sentMessageId: string }
  | { kind: "scope-required" }
  | { kind: "send-failed" };

export async function sendReply(
  threadId: string,
  editedBody: string,
  meta: SaveDraftMeta,
): Promise<SendReplyResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // 소유권 재확인 — gmailThreadId 는 DB 값을 신뢰 (meta 위변조 방지).
  const owned = await db
    .select({ gmailThreadId: emailThreads.gmailThreadId })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .where(and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)))
    .limit(1);

  if (owned.length === 0) throw new Error("Thread not found");
  // gmailThreadId 는 DB 값을 신뢰 (meta 위변조 방지).
  const gmailThreadId = owned[0].gmailThreadId;

  const { accessToken } = await getValidAccessToken(userId);

  try {
    const draft = await createDraft(accessToken, {
      gmailThreadId,
      toEmail: meta.toEmail,
      subject: meta.subject,
      inReplyTo: meta.inReplyTo,
      references: meta.references,
      cc: meta.cc,
      bcc: meta.bcc,
      body: editedBody,
    });
    const sent = await sendDraft(accessToken, draft.draftId);
    return { kind: "ok", sentMessageId: sent.sentMessageId };
  } catch (error) {
    if (error instanceof GmailScopeError) {
      logger.warn("email/sendReply", "scope-required", { userId, threadId });
      return { kind: "scope-required" };
    }
    // silent swallow 방지 — Gmail 에러 종류(reason/status)를 구조화 기록.
    // 반환 유니온은 불변(UI 가 generic 처리라 새 kind 가 무의미) — 관찰성만 보강.
    logger.error("email/sendReply", "send-failed", {
      userId,
      threadId,
      reason: error instanceof GmailError ? error.googleReason : undefined,
      status: error instanceof GmailError ? error.status : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "send-failed" };
  }
}
