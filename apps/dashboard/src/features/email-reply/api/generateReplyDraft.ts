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
import { draftReply, isRefusalDraft } from "@/shared/lib/llm/draft-reply";
import { resolveReplyModelId } from "@/shared/lib/llm/reply-model-registry";
import { getEmailSettings } from "@/entities/email-settings";
import { logger } from "@/shared/lib/log";

export type ReplyTone = "polite" | "concise" | "friendly";
export type ReplyLength = "short" | "medium" | "long";

export interface ToneDraft {
  tone: ReplyTone;
  body: string;
  /** isRefusalDraft 감지 시 true → UI 발송/저장 차단. */
  refusal: boolean;
}

export type GenerateReplyResult =
  | {
      kind: "ok";
      drafts: ToneDraft[];
      meta: {
        gmailThreadId: string;
        toEmail: string;
        subject: string;
        inReplyTo: string;
        references: string;
        originalBody: string;
        /** Message-ID 부재로 In-Reply-To/References 가 생략돼 답장이 새 스레드로
         *  분리될 수 있음 → 모달에서 사용자에게 경고. logger.warn 과 동일 조건. */
        threadingDegraded: boolean;
      };
    }
  | { kind: "llm-unavailable" }
  | { kind: "scope-required" };

export async function generateReplyDraft(
  threadId: string,
  length: ReplyLength = "medium",
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
    // fetch 실패 → snippet 폴백으로 진행 (초안은 생성). silent swallow 방지 위해 기록 —
    // 초안 품질이 저하되므로(본문 없이 snippet 기반) 운영에서 빈도 추적 필요.
    logger.warn("email/generateReplyDraft", "thread-fetch-failed-snippet-fallback", {
      threadId,
      message: error instanceof Error ? error.message : String(error),
    });
    bodyText = "";
  }

  // 본문 비면 snippet 폴백.
  if (!bodyText) bodyText = row.snippet ?? "";

  // 4. 답장 헤더 메타 구성.
  const headers = inbound?.payload?.headers;
  const messageId = findHeader(headers, "Message-ID") ?? "";
  // Message-ID 가 비면 In-Reply-To/References 헤더가 생략돼(drafts.ts) 답장이
  // 원 스레드에 안 붙고 새 스레드로 분리될 수 있다. 빈도 추적용 경고.
  if (!messageId) {
    logger.warn("email/generateReplyDraft", "missing-message-id-threading-degraded", {
      threadId,
      hadInbound: inbound !== null,
    });
  }
  const existingRefs = findHeader(headers, "References") ?? "";
  const replyTo = findHeader(headers, "Reply-To");
  const fromHeader = findHeader(headers, "From");
  const toEmail = replyTo ?? fromHeader ?? row.fromEmail ?? "";

  // 5. 사용자 설정 (언어 + 모델).
  const settings = await getEmailSettings(userId);
  const modelId = await resolveReplyModelId(settings.replyModel);

  // 6. 톤 3개 병렬 LLM 초안 (길이는 모달 선택값).
  const tones: ReplyTone[] = ["polite", "concise", "friendly"];
  const results = await Promise.all(
    tones.map((tone) =>
      draftReply({
        fromEmail: row.fromEmail ?? "",
        fromName: row.fromName ?? undefined,
        subject: row.subject ?? "",
        bodyText,
        severity: row.severity as "high" | "med" | "low",
        language: settings.replyLanguage,
        tone,
        length,
        modelId,
      }).then((r) => ({ tone, result: r })),
    ),
  );

  // 전부 실패면 llm-unavailable.
  const oks = results.filter((r) => r.result.kind === "ok");
  if (oks.length === 0) return { kind: "llm-unavailable" };

  const drafts: ToneDraft[] = oks.map((r) => {
    const body = (r.result as { kind: "ok"; body: string }).body;
    return { tone: r.tone, body, refusal: isRefusalDraft(body) };
  });

  return {
    kind: "ok",
    drafts,
    meta: {
      gmailThreadId: row.gmailThreadId,
      toEmail: extractEmail(toEmail) || (row.fromEmail ?? ""),
      subject: row.subject ?? "",
      inReplyTo: messageId,
      references: existingRefs ? `${existingRefs} ${messageId}`.trim() : messageId,
      originalBody: bodyText,
      threadingDegraded: !messageId,
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
