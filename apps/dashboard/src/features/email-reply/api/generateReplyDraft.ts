// "답장하기" 첫 클릭 → 본문 fetch + LLM 초안 생성.
// thread 전체를 한 번에 받아 inbound 메시지(상대 발신)를 선택, 본문·헤더 확보.
// DB 무저장 — 매 호출 fresh 생성.
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailThreads, replyNeeded, users } from "@/shared/lib/db/schema";
import {
  getValidAccessToken,
  getThread,
  extractBodyText,
  findHeader,
  GmailScopeError,
  type ThreadMessage,
} from "@/shared/api/gmail";
import { draftReply } from "@/shared/lib/llm/draft-reply";

export type GenerateReplyResult =
  | {
      kind: "ok";
      body: string;
      meta: {
        gmailThreadId: string;
        toEmail: string;
        subject: string;
        inReplyTo: string;
        references: string;
      };
    }
  | { kind: "llm-unavailable" }
  | { kind: "scope-required" };

export async function generateReplyDraft(
  threadId: string,
): Promise<GenerateReplyResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // 1. 소유권 확인 + gmailThreadId·snippet·발신자 확보.
  const rows = await db
    .select({
      gmailThreadId: emailThreads.gmailThreadId,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      fromEmail: emailThreads.lastSenderEmail,
      fromName: emailThreads.lastSenderName,
      severity: replyNeeded.severity,
      ownerEmail: users.email,
    })
    .from(replyNeeded)
    .innerJoin(emailThreads, eq(replyNeeded.threadId, emailThreads.id))
    .innerJoin(users, eq(replyNeeded.userId, users.id))
    .where(
      and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)),
    )
    .limit(1);

  if (rows.length === 0) throw new Error("Thread not found");
  const row = rows[0];

  // 2. access token.
  const { accessToken } = await getValidAccessToken(userId);

  // 3. thread 전체 fetch + inbound 메시지 선택.
  let inbound: ThreadMessage | null = null;
  let bodyText = "";
  try {
    const thread = await getThread(accessToken, row.gmailThreadId);
    inbound = pickInbound(thread.messages, row.ownerEmail ?? "");
    if (inbound?.payload) bodyText = extractBodyText(inbound.payload);
  } catch (error) {
    if (error instanceof GmailScopeError) return { kind: "scope-required" };
    // fetch 실패 → snippet 폴백으로 진행 (초안은 생성).
    bodyText = "";
  }

  // 본문 비면 snippet 폴백.
  if (!bodyText) bodyText = row.snippet ?? "";

  // 4. 답장 헤더 메타 구성.
  const headers = inbound?.payload?.headers;
  const messageId = findHeader(headers, "Message-ID") ?? "";
  const existingRefs = findHeader(headers, "References") ?? "";
  const replyTo = findHeader(headers, "Reply-To");
  const fromHeader = findHeader(headers, "From");
  const toEmail = replyTo ?? fromHeader ?? row.fromEmail ?? "";

  // 5. LLM 초안.
  const result = await draftReply({
    fromEmail: row.fromEmail ?? "",
    fromName: row.fromName ?? undefined,
    subject: row.subject ?? "",
    bodyText,
    severity: row.severity as "high" | "med" | "low",
  });

  if (result.kind === "llm-unavailable") return { kind: "llm-unavailable" };

  return {
    kind: "ok",
    body: result.body,
    meta: {
      gmailThreadId: row.gmailThreadId,
      toEmail: extractEmail(toEmail) || (row.fromEmail ?? ""),
      subject: row.subject ?? "",
      inReplyTo: messageId,
      references: existingRefs
        ? `${existingRefs} ${messageId}`.trim()
        : messageId,
    },
  };
}

// From이 ownerEmail이 아닌 마지막 메시지 = 상대가 보낸 가장 최근 메일.
// 전부 본인 발신이면 마지막 메시지로 폴백.
function pickInbound(
  messages: ThreadMessage[],
  ownerEmail: string,
): ThreadMessage | null {
  if (messages.length === 0) return null;
  const owner = ownerEmail.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const from =
      findHeader(messages[i].payload?.headers, "From") ?? "";
    if (extractEmail(from).toLowerCase() !== owner) return messages[i];
  }
  return messages[messages.length - 1];
}

// "이름 <a@b.com>" → "a@b.com". 꺾쇠 없으면 원문 trim.
function extractEmail(headerValue: string): string {
  const m = headerValue.match(/<([^>]+)>/);
  return (m ? m[1] : headerValue).trim();
}
