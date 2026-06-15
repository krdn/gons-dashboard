import { describe, it, expect } from "vitest";
import { classifyGmailError, GmailScopeError } from "./errors";

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
