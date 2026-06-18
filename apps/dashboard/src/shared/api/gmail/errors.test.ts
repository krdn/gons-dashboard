import { describe, it, expect } from "vitest";
import {
  classifyGmailError,
  classifyTokenError,
  GmailScopeError,
  InvalidGrantError,
  GmailClientError,
} from "./errors";

describe("classifyGmailError — scope insufficient", () => {
  it("403 + ACCESS_TOKEN_SCOPE_INSUFFICIENT → GmailScopeError", async () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
        errors: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      },
    });
    const res = new Response(body, { status: 403 });
    const err = await classifyGmailError(res);
    expect(err).toBeInstanceOf(GmailScopeError);
    expect(err.status).toBe(403);
  });
});

describe("classifyTokenError — OAuth token endpoint", () => {
  it("invalid_grant + error_description → InvalidGrantError (desc 보존)", () => {
    const err = classifyTokenError(
      { error: "invalid_grant", error_description: "Token has been expired or revoked." },
      400,
    );
    expect(err).toBeInstanceOf(InvalidGrantError);
    expect(err.message).toBe("Token has been expired or revoked.");
  });

  it("invalid_grant + description 없음 → InvalidGrantError (기본 메시지)", () => {
    const err = classifyTokenError({ error: "invalid_grant" }, 400);
    expect(err).toBeInstanceOf(InvalidGrantError);
    expect(err.message).toBe("invalid_grant");
  });

  it("다른 error 코드 → GmailClientError (invalid_grant 아님)", () => {
    const err = classifyTokenError({ error: "invalid_client" }, 401);
    expect(err).toBeInstanceOf(GmailClientError);
    expect(err).not.toBeInstanceOf(InvalidGrantError);
    expect(err.status).toBe(401);
  });

  it("error 필드 없는 body → GmailClientError", () => {
    const err = classifyTokenError({ foo: "bar" }, 500);
    expect(err).toBeInstanceOf(GmailClientError);
    expect(err.status).toBe(500);
  });

  it("non-object body(null) → GmailClientError", () => {
    const err = classifyTokenError(null, 400);
    expect(err).toBeInstanceOf(GmailClientError);
  });
});
