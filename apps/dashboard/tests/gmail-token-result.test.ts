// getGmailTokenOrResult — getValidAccessToken try/catch + InvalidGrantError 분기를 결과로.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/api/gmail/auth", () => ({
  getValidAccessToken: vi.fn(),
}));

import { getValidAccessToken } from "@/shared/api/gmail/auth";
import { InvalidGrantError } from "@/shared/api/gmail/errors";
import { getGmailTokenOrResult } from "@/shared/api/gmail/tokenResult";

const mockedGetToken = getValidAccessToken as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedGetToken.mockReset();
});

describe("getGmailTokenOrResult", () => {
  it("성공 → { ok: true, token }", async () => {
    mockedGetToken.mockResolvedValue({ accessToken: "tok-xyz" });
    const result = await getGmailTokenOrResult("user-1");
    expect(result).toEqual({ ok: true, token: "tok-xyz" });
  });

  it("InvalidGrantError → { ok: false, reason: 'reauth-required' }", async () => {
    mockedGetToken.mockRejectedValue(new InvalidGrantError("revoked"));
    const result = await getGmailTokenOrResult("user-1");
    expect(result).toEqual({ ok: false, reason: "reauth-required" });
  });

  it("그 외 예외 → { ok: false, reason: 'auth-error' }", async () => {
    mockedGetToken.mockRejectedValue(new Error("network timeout"));
    const result = await getGmailTokenOrResult("user-1");
    expect(result).toEqual({ ok: false, reason: "auth-error" });
  });

  it("throw 안 함 — 호출자는 try-catch 불필요", async () => {
    mockedGetToken.mockRejectedValue(new TypeError("bad request"));
    // 다음 호출이 throw 하면 test 자체가 실패함.
    const result = await getGmailTokenOrResult("user-1");
    expect(result.ok).toBe(false);
  });
});
