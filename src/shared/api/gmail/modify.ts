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

// threads.modify 응답: { id, historyId, messages: [...] }
// (messages.modify 와 혼동 금지 — messages.modify 는 { id, threadId, labelIds }
//  단일 message 객체를 반환. 우리는 threads.modify 호출하므로 thread 객체.)
// 호출자(markAsRead/archiveThread)가 반환값을 사용하지 않아 스키마는 "응답이 JSON
// object 인지" 만 확인. 필드 strict 검증은 과거 ZodError 회귀의 원인이라 의도적으로
// 느슨하게 둠.
const ModifyResponseSchema = z.object({
  id: z.string(),
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
