// Gmail API 에러 분류 — eng review §3 D3·D4의 분기를 코드 레벨에서 식별.
//
//  - InvalidGrantError: refresh token 만료 (7일 Test 모드 한계)
//      → users.oauth_state = 'reauth_required', 외부 알림 메일, 대시보드 배너
//  - HistoryStaleError: history_id 폐기 (7일+ 멈춤 후 재시작)
//      → full-rescan으로 fallback
//  - GmailRateLimitError: 429 / userRateLimitExceeded
//      → exponential backoff 재시도
//  - GmailServerError: 5xx
//      → exponential backoff 재시도
//  - GmailClientError: 4xx (위 셋 외) — 로직 오류, 재시도 X
import "server-only";

export class GmailError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly googleReason?: string,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

export class InvalidGrantError extends GmailError {
  constructor(message = "OAuth refresh token이 만료되거나 취소됨") {
    super(message, 400, "invalid_grant");
    this.name = "InvalidGrantError";
  }
}

export class HistoryStaleError extends GmailError {
  constructor(message = "Gmail history_id가 폐기됨 — full rescan 필요") {
    super(message, 404, "historyId not found");
    this.name = "HistoryStaleError";
  }
}

export class GmailRateLimitError extends GmailError {
  constructor(message = "Gmail API rate limit") {
    super(message, 429, "rateLimitExceeded");
    this.name = "GmailRateLimitError";
  }
}

export class GmailServerError extends GmailError {
  constructor(status: number, message = "Gmail API 서버 오류") {
    super(message, status);
    this.name = "GmailServerError";
  }
}

export class GmailClientError extends GmailError {
  constructor(status: number, message: string, googleReason?: string) {
    super(message, status, googleReason);
    this.name = "GmailClientError";
  }
}

/**
 * Google API 에러 응답을 우리 에러 클래스로 분류.
 * https://developers.google.com/gmail/api/guides/handle-errors
 */
export async function classifyGmailError(response: Response): Promise<GmailError> {
  const status = response.status;

  // body 는 한 번만 consume. text 로 읽고 JSON 파싱 시도 → 실패 시 string 그대로.
  // 이전 버전은 `response.json() → response.text()` 순으로 두 번 consume 했는데,
  // Response body 는 한 번만 읽을 수 있어 두 번째 호출이 "Body is unusable" 로 throw.
  // 결과: Google CDN 의 502 HTML 응답 시 cron 이 opaque 에러로 죽음.
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // text 그대로 유지. typeof 검사가 string 을 거부해 fallthrough → GmailClientError.
  }

  const errorObj =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error: unknown }).error
      : null;

  const reason = extractReason(errorObj);
  const message = extractMessage(errorObj) ?? `HTTP ${status}`;

  // history.list 의 404는 "historyId not found" 시 stale로 분류 (다른 404와 구분).
  if (status === 404 && /history.*not found|invalid.*history/i.test(message)) {
    return new HistoryStaleError(message);
  }

  if (status === 429) return new GmailRateLimitError(message);
  if (status >= 500) return new GmailServerError(status, message);
  if (reason === "invalid_grant") return new InvalidGrantError(message);

  return new GmailClientError(status, message, reason ?? undefined);
}

/**
 * Google OAuth token endpoint의 에러도 분류.
 * 포맷: { error: 'invalid_grant', error_description: '...' }
 */
export function classifyTokenError(body: unknown, status: number): GmailError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (error === "invalid_grant") {
      const desc =
        "error_description" in body
          ? String((body as { error_description: unknown }).error_description)
          : "invalid_grant";
      return new InvalidGrantError(desc);
    }
  }
  return new GmailClientError(status, `Token endpoint 오류: HTTP ${status}`);
}

function extractReason(errorObj: unknown): string | null {
  if (typeof errorObj !== "object" || errorObj === null) return null;
  if ("errors" in errorObj && Array.isArray((errorObj as { errors: unknown[] }).errors)) {
    const first = (errorObj as { errors: { reason?: unknown }[] }).errors[0];
    if (first && typeof first.reason === "string") return first.reason;
  }
  if ("status" in errorObj && typeof (errorObj as { status: unknown }).status === "string") {
    return (errorObj as { status: string }).status;
  }
  return null;
}

function extractMessage(errorObj: unknown): string | null {
  if (typeof errorObj !== "object" || errorObj === null) return null;
  if ("message" in errorObj && typeof (errorObj as { message: unknown }).message === "string") {
    return (errorObj as { message: string }).message;
  }
  return null;
}

/**
 * 재시도 가능 여부 판정 — exponential backoff 로직에서 사용.
 */
export function isRetryable(error: GmailError): boolean {
  return (
    error instanceof GmailRateLimitError || error instanceof GmailServerError
  );
}
