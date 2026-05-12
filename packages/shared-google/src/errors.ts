// shared-google — 도메인별 mcp-* 패키지가 분기할 수 있도록 에러를 분류.
//
// OAuthExpiredError: mediator가 410 — refresh token 자체가 무효.
//   호출자는 사용자에게 재로그인 안내 (위젯 배너, Claude 에러 메시지).
// TransientError: 429/5xx/네트워크 — 재시도 가능.
//   shared-google 내부에서 1회 backoff 재시도 후에도 실패 시 throw.

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export class OAuthExpiredError extends GoogleApiError {
  constructor(message = "Google OAuth refresh token이 만료되었습니다") {
    super(message, 410);
    this.name = "OAuthExpiredError";
  }
}

export class TransientError extends GoogleApiError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "TransientError";
  }
}
