import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDraft } from "./send";
import { GmailScopeError } from "./errors";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => fetchMock.mockReset());

describe("sendDraft", () => {
  it("성공 → sentMessageId 반환", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "msg-1", threadId: "t-1" }), { status: 200 }),
    );
    const r = await sendDraft("token", "draft-1");
    expect(r.sentMessageId).toBe("msg-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/drafts/send");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ id: "draft-1" });
  });

  it("403 (scope insufficient) → GmailScopeError", async () => {
    // classifyGmailError 는 status==403 AND error.status==="ACCESS_TOKEN_SCOPE_INSUFFICIENT"
    // 일 때만 GmailScopeError. scope 부족 403 을 정확히 재현하려면 그 트리거 필드 필요.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 403, status: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", message: "insufficient" },
        }),
        { status: 403 },
      ),
    );
    await expect(sendDraft("token", "draft-1")).rejects.toBeInstanceOf(GmailScopeError);
  });
});
