// Gmail messages.modify API — 라벨 추가/제거.
// 액션 서버 함수(markAsRead, archiveThread)가 호출.
//
// 멱등: Gmail은 이미 없는 라벨을 제거 요청해도 200 OK.
// 404: 메시지가 사라진 경우 — 호출자가 archived_at SET으로 처리.
import "server-only";
import { z } from "zod";
import { classifyGmailError, isRetryable, GmailError } from "./errors";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

const ModifyResponseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});

export type ModifyResponse = z.infer<typeof ModifyResponseSchema>;

export interface ModifyOptions {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

/**
 * Gmail 스레드의 라벨 수정. UNREAD 제거 → 읽음 처리, INBOX 제거 → 보관.
 */
export async function modifyThread(
  accessToken: string,
  gmailThreadId: string,
  options: ModifyOptions,
): Promise<ModifyResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API}/threads/${gmailThreadId}/modify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          addLabelIds: options.addLabelIds ?? [],
          removeLabelIds: options.removeLabelIds ?? [],
        }),
      });
      if (!res.ok) {
        const err = await classifyGmailError(res);
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          lastErr = err;
          continue;
        }
        throw err;
      }
      const json = await res.json();
      return ModifyResponseSchema.parse(json);
    } catch (err) {
      if (err instanceof GmailError) throw err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
