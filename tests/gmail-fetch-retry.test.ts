// shared/api/gmail/messages — getMessage 의 retry/backoff 동작.
//
// fetchWithRetry 는 private 이지만 getMessage 가 사용하므로 간접 검증.
// 검증 포인트:
//   - 429 / 5xx 는 최대 3회 재시도 후 throw
//   - 4xx (InvalidGrant 외) 는 즉시 throw, 재시도 X
//   - 429 → 200 첫 시도 재시도면 정상 반환
//
// fake timer 로 backoff (500/1000/2000ms) 를 즉시 진행.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getMessage } from "@/shared/api/gmail/messages";
import {
  GmailRateLimitError,
  GmailServerError,
  GmailClientError,
} from "@/shared/api/gmail/errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successPayload() {
  return {
    id: "msg-1",
    threadId: "thr-1",
    snippet: "hello",
    internalDate: "1700000000000",
    payload: { headers: [] },
  };
}

describe("getMessage (fetchWithRetry)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("첫 호출 200 → 즉시 반환, retry 미발생", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, successPayload()),
    );

    const promise = getMessage("tok", "msg-1");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.id).toBe("msg-1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("429 1회 → 200 → 정상 반환 (재시도 1회)", async () => {
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { message: "rate limited" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, successPayload()));

    const promise = getMessage("tok", "msg-1");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.id).toBe("msg-1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("503 3회 연속 → GmailServerError throw (MAX_RETRIES 도달)", async () => {
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue(
      jsonResponse(503, { error: { message: "internal" } }),
    );

    const promise = getMessage("tok", "msg-1");
    // rejection handler 를 timer 진행 전에 등록 — unhandled rejection 방지.
    const rejection = expect(promise).rejects.toBeInstanceOf(GmailServerError);
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("403 (비 재시도) → 즉시 throw, retry 미발생", async () => {
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(
      jsonResponse(403, { error: { message: "forbidden" } }),
    );

    const promise = getMessage("tok", "msg-1");
    const rejection = expect(promise).rejects.toBeInstanceOf(GmailClientError);
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("429 → 503 → 200 (mixed retryable, 3 attempts)", async () => {
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "x" } }))
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: "y" } }))
      .mockResolvedValueOnce(jsonResponse(200, successPayload()));

    const promise = getMessage("tok", "msg-1");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.id).toBe("msg-1");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("429 3회 연속 → GmailRateLimitError throw", async () => {
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue(
      jsonResponse(429, { error: { message: "rate limited" } }),
    );

    const promise = getMessage("tok", "msg-1");
    const rejection = expect(promise).rejects.toBeInstanceOf(GmailRateLimitError);
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
