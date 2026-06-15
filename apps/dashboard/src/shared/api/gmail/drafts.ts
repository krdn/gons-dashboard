// Gmail drafts.create — 기존 스레드에 답장 초안 추가.
// 스레딩 3조건 (https://developers.google.com/gmail/api/guides/threads):
//   ① message.threadId 명시  ② In-Reply-To/References 헤더  ③ Subject 일치(Re:)
// 한글 안전: Subject는 MIME encoded-word, body는 UTF-8 charset.
import "server-only";
import { z } from "zod";
import { classifyGmailError } from "./errors";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface DraftParams {
  gmailThreadId: string;
  toEmail: string;
  /** 원본 Subject (이미 Re: 포함돼 있으면 중복 안 붙임). */
  subject: string;
  /** 답장 대상 메시지의 Message-ID 헤더. */
  inReplyTo: string;
  /** 기존 References 체인 + inReplyTo. */
  references: string;
  /** 사용자가 편집한 답장 본문. */
  body: string;
}

const CreateDraftResponseSchema = z.object({
  id: z.string(),
  message: z.object({ id: z.string() }).passthrough().optional(),
});

export interface CreateDraftResult {
  draftId: string;
}

// 헤더 인젝션 방지 — CR/LF 제거 (inbound 데이터가 헤더 값으로 들어오므로).
function sanitizeHeader(v: string): string {
  return v.replace(/[\r\n]/g, "");
}

function encodeSubject(subject: string): string {
  // CRLF 는 헤더 인젝션 통로 — ASCII guard 경로도 통과시키므로 맨 앞에서 제거.
  const clean = subject.replace(/[\r\n]/g, " ");
  const re = /^re:/i.test(clean) ? clean : `Re: ${clean}`;
  // ASCII만 있으면 그대로, 비ASCII 포함 시 encoded-word.
  if (/^[\x00-\x7F]*$/.test(re)) return re;
  const b64 = Buffer.from(re, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildRfc822(params: DraftParams): string {
  const headers = [
    `To: ${sanitizeHeader(params.toEmail)}`,
    `Subject: ${encodeSubject(params.subject)}`,
    `In-Reply-To: ${sanitizeHeader(params.inReplyTo)}`,
    `References: ${sanitizeHeader(params.references)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "MIME-Version: 1.0",
  ];
  // RFC822 는 줄 끝이 CRLF — textarea 입력 body 의 LF-only 를 정규화.
  return headers.join("\r\n") + "\r\n\r\n" + params.body.replace(/\r?\n/g, "\r\n");
}

export async function createDraft(
  accessToken: string,
  params: DraftParams,
): Promise<CreateDraftResult> {
  const raw = toBase64Url(buildRfc822(params));
  const response = await fetch(`${API}/drafts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { threadId: params.gmailThreadId, raw },
    }),
  });
  if (!response.ok) {
    throw await classifyGmailError(response);
  }
  const parsed = CreateDraftResponseSchema.parse(await response.json());
  return { draftId: parsed.id };
}
