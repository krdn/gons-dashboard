// 편집된 답장 본문 → Gmail 초안 생성 후 즉시 발송. DB 무저장.
// createDraft → sendDraft 2-step (기존 draft 인프라 재사용).
// 소유권은 DB의 gmailThreadId 로 재검증 (클라이언트 meta 불신).
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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
import { ROUTE_DASHBOARD } from "@/shared/config/routes";
import { isRefusalDraft } from "@/shared/lib/llm/draft-reply";
import { validateRecipients, type RecipientField } from "../lib/validateRecipients";
import type { SaveDraftMeta } from "./saveReplyDraft";

export type SendReplyResult =
  | { kind: "ok"; sentMessageId: string }
  | { kind: "scope-required" }
  | { kind: "invalid-recipient"; field: RecipientField }
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

  // 비가역 발송 직전 입력 검증 (createDraft/sendDraft 전).
  // 1. 수신자 형식 — 실사용자 오타가 Gmail 400 으로 늦게 드러나는 것 방지.
  const recipients = validateRecipients(meta);
  if (!recipients.ok) {
    return { kind: "invalid-recipient", field: recipients.field };
  }
  // 2. refusal 서버 재검증 (defense-in-depth) — client 게이트는 생성시점 플래그
  //    기반이라 직접 RPC bypass 가능. editedBody 를 직접 재검사(더 정확).
  //    공격자 전용 경로라 전용 kind 없이 send-failed 재사용 + 로깅.
  if (isRefusalDraft(editedBody)) {
    logger.warn("email/sendReply", "refusal-blocked-server", { userId, threadId });
    return { kind: "send-failed" };
  }

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

    // 여기서부터 발송은 이미 완료(비가역). repliedAt 기록은 부수 bookkeeping이므로
    // 실패해도 결과를 send-failed로 뒤집으면 안 된다 — 그러면 사용자가 재발송해
    // 수신자가 메일을 두 번 받는 비가역 사고가 난다. best-effort로 분리.
    // 갱신해야 getReplyNeeded(repliedAt IS NULL)가 답장한 스레드를 재등장시키지 않는다.
    // 소유권은 위에서 이미 검증 (markAsReplied 재호출 시 중복 auth/소유권 쿼리 회피).
    try {
      const now = new Date();
      await db
        .update(replyNeeded)
        .set({ repliedAt: now, userAction: "replied", userActionAt: now })
        .where(
          and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)),
        );
      revalidatePath(ROUTE_DASHBOARD);
    } catch (dbErr) {
      // 발송은 성공했으므로 ok 유지. 최악 = 위젯 재등장(수동 '답장 완료'로 복구).
      logger.error("email/sendReply", "replied-update-failed-after-send", {
        userId,
        threadId,
        message: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

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
