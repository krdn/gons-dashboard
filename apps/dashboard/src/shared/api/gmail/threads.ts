// Gmail threads.get — format=full로 thread 전체 메시지(본문 payload 포함) 조회.
// 답장 초안 생성 시 inbound 메시지 본문·헤더 확보용. getMessage(metadata)와 별개.
import "server-only";
import { z } from "zod";
import { classifyGmailError, isRetryable, GmailError } from "./errors";
import type { GmailPayload } from "./mime";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

const HeaderSchema = z.object({ name: z.string(), value: z.string() });

// payload는 재귀 구조라 z.lazy 없이 loose하게(passthrough) 받고 mime.ts에 위임.
const ThreadMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  internalDate: z.string().optional(),
  payload: z
    .object({
      mimeType: z.string().optional().default("text/plain"),
      headers: z.array(HeaderSchema).optional(),
    })
    .passthrough()
    .optional(),
});

const ThreadSchema = z.object({
  id: z.string(),
  messages: z.array(ThreadMessageSchema).optional().default([]),
});

export interface ThreadMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPayload;
}

export interface GmailThread {
  id: string;
  messages: ThreadMessage[];
}

/**
 * threads.get — 스레드의 모든 메시지(full payload 포함) 조회.
 *
 * format=full로 호출하여 각 메시지의 payload(본문 + 헤더)를 모두 받음.
 * 답장 초안 생성 시 원본 메시지 본문이 필요할 때 사용.
 *
 * @param accessToken Bearer token
 * @param gmailThreadId 스레드 ID
 * @returns 메시지 배열을 포함한 스레드 객체
 * @throws GmailError 및 하위 에러 클래스들
 */
export async function getThread(
  accessToken: string,
  gmailThreadId: string,
): Promise<GmailThread> {
  const url = `${API}/threads/${encodeURIComponent(gmailThreadId)}?format=full`;
  const response = await fetchWithRetry(url, accessToken);
  const body = (await response.json()) as unknown;
  const parsed = ThreadSchema.parse(body);
  return parsed as unknown as GmailThread;
}

/**
 * Bearer fetch + 재시도 (rate limit / 5xx).
 */
async function fetchWithRetry(
  url: string,
  accessToken: string,
): Promise<Response> {
  let lastError: GmailError | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.ok) return response;

    const error = await classifyGmailError(response);
    if (!isRetryable(error)) throw error;

    lastError = error;
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
    await sleep(delay);
  }

  throw lastError ?? new Error("재시도 후에도 실패");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
