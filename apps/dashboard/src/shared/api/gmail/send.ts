// Gmail drafts.send — 기존 초안을 발송.
// createDraft 로 만든 draftId 를 전송 → Gmail 이 스레딩/헤더 보존한 채 발송.
// scope: gmail.modify 가 drafts.send 를 허용 (Google 문서 검증 2026-06-16).
import "server-only";
import { z } from "zod";
import { classifyGmailError } from "./errors";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const SendResponseSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

export interface SendDraftResult {
  sentMessageId: string;
}

export async function sendDraft(
  accessToken: string,
  draftId: string,
): Promise<SendDraftResult> {
  const response = await fetch(`${API}/drafts/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: draftId }),
  });
  if (!response.ok) {
    throw await classifyGmailError(response);
  }
  const parsed = SendResponseSchema.parse(await response.json());
  return { sentMessageId: parsed.id };
}
