// shared/api/gmail/errors — classifyGmailError / classifyTokenError / isRetryable.
//
// 핵심: Google API 의 에러 응답 (status + body.error) 을 우리 에러 클래스로 분류.
// fetch retry 로직 (messages.ts) 이 이 분류 결과에 의존하므로 회귀 방어 가치 높음.
import { describe, it, expect } from "vitest";
import {
  classifyGmailError,
  classifyTokenError,
  isRetryable,
  isSkippableMessageError,
  GmailError,
  InvalidGrantError,
  HistoryStaleError,
  GmailRateLimitError,
  GmailServerError,
  GmailClientError,
  GmailScopeError,
} from "@/shared/api/gmail/errors";

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("classifyGmailError", () => {
  it("404 + 'historyId not found' → HistoryStaleError", async () => {
    const res = makeJsonResponse(404, {
      error: {
        message: "Requested entity was not found: historyId not found",
        errors: [{ reason: "notFound" }],
      },
    });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(HistoryStaleError);
    expect(err.status).toBe(404);
  });

  it("404 + 일반 메시지 → GmailClientError (HistoryStale 아님)", async () => {
    const res = makeJsonResponse(404, {
      error: {
        message: "Message not found",
        errors: [{ reason: "notFound" }],
      },
    });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(GmailClientError);
    expect(err).not.toBeInstanceOf(HistoryStaleError);
    expect(err.status).toBe(404);
  });

  it("429 → GmailRateLimitError", async () => {
    const res = makeJsonResponse(429, {
      error: { message: "Rate limit exceeded" },
    });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(GmailRateLimitError);
  });

  it("500/503 → GmailServerError", async () => {
    for (const status of [500, 502, 503]) {
      const res = makeJsonResponse(status, {
        error: { message: "internal" },
      });
      const err = await classifyGmailError(res);
      expect(err).toBeInstanceOf(GmailServerError);
      expect(err.status).toBe(status);
    }
  });

  it("401 + reason=invalid_grant → InvalidGrantError", async () => {
    const res = makeJsonResponse(401, {
      error: {
        message: "Invalid Credentials",
        errors: [{ reason: "invalid_grant" }],
      },
    });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(InvalidGrantError);
  });

  it("403 → GmailClientError (재시도 X)", async () => {
    const res = makeJsonResponse(403, {
      error: { message: "Forbidden" },
    });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(GmailClientError);
    expect(isRetryable(err)).toBe(false);
  });

  it("body 가 JSON 이 아니어도 throw 안 함 (text fallback)", async () => {
    const res = new Response("<!DOCTYPE html><html>...</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(GmailServerError);
    expect(err.status).toBe(502);
  });

  it("message 없을 때 → fallback 'HTTP <status>'", async () => {
    const res = makeJsonResponse(418, { error: {} });
    const err = await classifyGmailError(res);
    expect(err.message).toBe("HTTP 418");
  });
});

describe("classifyTokenError", () => {
  it("invalid_grant + error_description → InvalidGrantError", () => {
    const err = classifyTokenError(
      { error: "invalid_grant", error_description: "Token has been revoked" },
      400,
    );
    expect(err).toBeInstanceOf(InvalidGrantError);
    expect(err.message).toBe("Token has been revoked");
  });

  it("invalid_grant 만 (description 없음) → InvalidGrantError 기본 메시지", () => {
    const err = classifyTokenError({ error: "invalid_grant" }, 400);
    expect(err).toBeInstanceOf(InvalidGrantError);
  });

  it("다른 error 코드 → GmailClientError", () => {
    const err = classifyTokenError({ error: "unauthorized_client" }, 400);
    expect(err).toBeInstanceOf(GmailClientError);
    expect(err).not.toBeInstanceOf(InvalidGrantError);
  });

  it("body 가 객체 아님 → GmailClientError", () => {
    const err = classifyTokenError("oops", 500);
    expect(err).toBeInstanceOf(GmailClientError);
  });

  it("body 가 null → GmailClientError", () => {
    const err = classifyTokenError(null, 500);
    expect(err).toBeInstanceOf(GmailClientError);
  });
});

describe("isRetryable", () => {
  it("GmailRateLimitError → true", () => {
    expect(isRetryable(new GmailRateLimitError())).toBe(true);
  });

  it("GmailServerError → true", () => {
    expect(isRetryable(new GmailServerError(503))).toBe(true);
  });

  it("InvalidGrantError → false (재시도 의미 없음)", () => {
    expect(isRetryable(new InvalidGrantError())).toBe(false);
  });

  it("HistoryStaleError → false (fallback 로직 별도)", () => {
    expect(isRetryable(new HistoryStaleError())).toBe(false);
  });

  it("GmailClientError → false (4xx 로직 오류는 재시도 X)", () => {
    expect(isRetryable(new GmailClientError(403, "forbidden"))).toBe(false);
  });

  it("baseclass GmailError → false (구체적 케이스 아님)", () => {
    expect(isRetryable(new GmailError("?", 400))).toBe(false);
  });
});

// #24 회귀 가드 — sync 루프가 단일 메시지 실패를 skip할지 전파할지.
// poison 메시지(404 삭제 등)는 skip해 historyId 전진을 막지 않아야 stall이 안 생기고,
// 계정 단위 실패(invalid_grant)는 전파해 토큰 만료를 silent하게 삼키지 않아야 한다.
describe("isSkippableMessageError", () => {
  it("GmailClientError(404 삭제된 메시지) → true (그 메시지만 skip)", () => {
    expect(
      isSkippableMessageError(new GmailClientError(404, "Not Found", "notFound")),
    ).toBe(true);
  });

  it("GmailClientError(기타 4xx) → true", () => {
    expect(isSkippableMessageError(new GmailClientError(400, "Bad Request"))).toBe(
      true,
    );
  });

  it("GmailServerError(일시 5xx, 재시도 소진) → true (사이클 전체 안 죽임)", () => {
    expect(isSkippableMessageError(new GmailServerError(503, "unavailable"))).toBe(
      true,
    );
  });

  it("InvalidGrantError → false (계정 단위 — 전파해 reauth 처리)", () => {
    expect(isSkippableMessageError(new InvalidGrantError())).toBe(false);
  });

  it("GmailScopeError → false (계정 단위 — 전파)", () => {
    expect(isSkippableMessageError(new GmailScopeError())).toBe(false);
  });

  it("비-Gmail 에러(DB·예상외) → false (silent swallow 금지)", () => {
    expect(isSkippableMessageError(new Error("db connection lost"))).toBe(false);
    expect(isSkippableMessageError("문자열 에러")).toBe(false);
    expect(isSkippableMessageError(null)).toBe(false);
  });
});
