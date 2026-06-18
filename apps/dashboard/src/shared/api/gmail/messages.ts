// Gmail Messages API 래퍼 — messages.list / messages.get
//
// list: full-rescan fallback 시 사용 (history_id stale 후).
// get: 특정 메시지의 헤더·snippet·body 가져옴.
//
// metadataHeaders로 필요한 헤더만 받아 페이로드 절감 (분류에 필요한 것: From, Subject, Date, To).
import "server-only";
import { z } from "zod";
import { classifyGmailError, isRetryable, GmailError } from "./errors";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

export interface GmailHeader {
  name: string;
  value: string;
}

const MessageRefSchema = z.object({
  id: z.string(),
  threadId: z.string(),
});

const MessageDetailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  snippet: z.string().optional().default(""),
  internalDate: z.string().optional(), // millis since epoch (string)
  payload: z
    .object({
      headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    })
    .optional(),
  labelIds: z.array(z.string()).optional(),
});

export type MessageRef = z.infer<typeof MessageRefSchema>;
export type MessageDetail = z.infer<typeof MessageDetailSchema>;

const ListResponseSchema = z.object({
  messages: z.array(MessageRefSchema).optional().default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

/**
 * messages.list — full rescan fallback 또는 첫 sync 시 사용.
 *
 * @param accessToken Bearer token
 * @param query Gmail search query 문법 (예: "newer_than:7d -in:sent")
 * @returns 페이지네이션 다 소진한 모든 message ref 배열.
 *
 * D9 결정: while 루프로 nextPageToken 다 소진. 50개+ 시뮬레이션 테스트 필수.
 */
export async function listMessages(
  accessToken: string,
  query: string,
  maxPages = 20,
): Promise<MessageRef[]> {
  const all: MessageRef[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetchWithRetry(
      `${API}/messages?${params.toString()}`,
      accessToken,
    );
    const body = (await response.json()) as unknown;
    const parsed = ListResponseSchema.parse(body);

    all.push(...parsed.messages);
    pageToken = parsed.nextPageToken;
    pages += 1;
  } while (pageToken && pages < maxPages);

  return all;
}

/**
 * messages.get — 단일 메시지의 메타데이터 + snippet 조회.
 *
 * format=metadata로 본문 제외, metadataHeaders로 필요한 헤더만.
 * 디자인 문서의 "본문 5KB 절단 + snippet ~200자" 정책 따름.
 */
export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<MessageDetail> {
  const params = new URLSearchParams({
    format: "metadata",
    metadataHeaders: "From",
  });
  // metadataHeaders는 반복 가능 — URLSearchParams로는 append 사용.
  params.append("metadataHeaders", "To");
  params.append("metadataHeaders", "Subject");
  params.append("metadataHeaders", "Date");
  params.append("metadataHeaders", "Reply-To");
  // 메일링리스트 1차 컷(unsubscribe-filter)이 의존하는 신호 헤더.
  // 빠지면 extractMailingListSignals가 항상 false → 선필터 3/4 규칙이 죽고
  // 표준 뉴스레터가 전부 LLM 분류기로 넘어간다.
  params.append("metadataHeaders", "List-Unsubscribe");
  params.append("metadataHeaders", "List-ID");
  params.append("metadataHeaders", "Precedence");

  const response = await fetchWithRetry(
    `${API}/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
    accessToken,
  );
  const body = (await response.json()) as unknown;
  return MessageDetailSchema.parse(body);
}

/**
 * 메시지 헤더 배열에서 특정 이름의 값 추출. 헤더 이름은 case-insensitive.
 */
export function findHeader(
  headers: GmailHeader[] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
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
