// Gmail History API 래퍼 — incremental polling.
//
// history.list?startHistoryId=<saved> 로 마지막 sync 이후 변경분만 받음.
// 404 historyId not found → HistoryStaleError → 호출자가 full-rescan으로 fallback.
//
// D9 결정: while 루프로 nextPageToken 모두 소진.
// (50개+ 변경 시뮬레이션 테스트 필수, eng review §3 CRITICAL #2)
import "server-only";
import { z } from "zod";
import {
  classifyGmailError,
  isRetryable,
  GmailError,
  GmailClientError,
  HistoryStaleError,
} from "./errors";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

const MessageRefSchema = z.object({
  id: z.string(),
  threadId: z.string(),
});

const HistoryEntrySchema = z.object({
  id: z.string(),
  messages: z.array(MessageRefSchema).optional().default([]),
  messagesAdded: z
    .array(z.object({ message: MessageRefSchema }))
    .optional()
    .default([]),
});

const HistoryResponseSchema = z.object({
  history: z.array(HistoryEntrySchema).optional().default([]),
  historyId: z.string().optional(),
  nextPageToken: z.string().optional(),
});

export interface HistoryListResult {
  /** 새로 추가된 메시지 ref들 (중복 제거됨). */
  newMessageRefs: { id: string; threadId: string }[];
  /** 다음 polling에 저장할 historyId. 결과가 비어있으면 입력 historyId 그대로 반환. */
  newHistoryId: string;
}

/**
 * history.list 모든 페이지를 소진하여 새 메시지 ref들 반환.
 *
 * @throws HistoryStaleError 404 응답 시 — 호출자는 full-rescan으로 fallback.
 */
export async function listHistorySince(
  accessToken: string,
  startHistoryId: string,
  maxPages = 20,
): Promise<HistoryListResult> {
  const seen = new Set<string>();
  const newRefs: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  let lastHistoryId = startHistoryId;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);

    let response: Response;
    try {
      response = await fetchWithRetry(
        `${API}/history?${params.toString()}`,
        accessToken,
      );
    } catch (err) {
      // history endpoint의 404는 실무상 stale historyId 외 의미 없음.
      // Google이 메시지 문구를 "Requested entity was not found." 같이 바꿔도
      // endpoint+status로 분류하면 message 의존이 사라짐.
      if (err instanceof GmailClientError && err.status === 404) {
        throw new HistoryStaleError(err.message);
      }
      throw err;
    }
    const body = (await response.json()) as unknown;
    const parsed = HistoryResponseSchema.parse(body);

    for (const entry of parsed.history) {
      // messagesAdded가 표준이지만 messages도 fallback으로 처리.
      const adds = entry.messagesAdded.length
        ? entry.messagesAdded.map((a) => a.message)
        : entry.messages;
      for (const msg of adds) {
        if (!seen.has(msg.id)) {
          seen.add(msg.id);
          newRefs.push(msg);
        }
      }
    }

    if (parsed.historyId) lastHistoryId = parsed.historyId;
    pageToken = parsed.nextPageToken;
    pages += 1;
  } while (pageToken && pages < maxPages);

  return { newMessageRefs: newRefs, newHistoryId: lastHistoryId };
}

/**
 * 첫 sync 시 사용 — profile.getHistoryId로 현재 historyId만 받아옴.
 * 메시지는 fetch하지 않고, 다음 polling부터 incremental.
 */
export async function getCurrentHistoryId(
  accessToken: string,
): Promise<string> {
  const response = await fetchWithRetry(`${API}/profile`, accessToken);
  const body = (await response.json()) as unknown;
  const parsed = z.object({ historyId: z.string() }).parse(body);
  return parsed.historyId;
}

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
