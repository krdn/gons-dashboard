import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./playmcp-credentials", () => ({
  ensureAccessToken: vi.fn().mockResolvedValue("test-access-token"),
}));
vi.mock("@/shared/config/env", () => ({
  env: { PLAYMCP_GATEWAY_URL: "https://playmcp.test/mcp" },
}));

beforeEach(() => {
  vi.resetModules();
});

// MCP 표준 3-call 흐름: initialize → notifications/initialized → tools/call
// initialize 응답은 Mcp-Session-Id 헤더 + plain JSON 본문.
// tools/call 응답은 SSE (data: {...}) 형식, result.content[0].text 안에 PlayMCP raw JSON.
function makeMockFetch(toolPayloadJson: string) {
  const sessionId = "test-session-abc";
  return vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.method === "initialize") {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "mcp-session-id": sessionId }),
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
      } as unknown as Response;
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: true,
        status: 202,
        headers: new Headers(),
        text: async () => "",
      } as unknown as Response;
    }
    if (body.method === "tools/call") {
      const envelope = {
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: toolPayloadJson }] },
      };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        text: async () => `event: message\ndata: ${JSON.stringify(envelope)}\n\n`,
      } as unknown as Response;
    }
    throw new Error(`unexpected method: ${body.method}`);
  });
}

describe("callTool", () => {
  it("3-call MCP 흐름 (initialize + notifications/initialized + tools/call) + Bearer 헤더", async () => {
    const { callTool } = await import("./playmcp-client");
    const fetchMock = makeMockFetch(
      JSON.stringify({ result: { profile: { nickname_full: "x" } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const payload = await callTool<{ result: { profile: { nickname_full: string } } }>(
      "1fate-analyze_saju",
      { birth_date: "1990-01-01", gender: "male", calendar: "solar" },
    );
    expect(payload.result.profile.nickname_full).toBe("x");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const [, init] = call;
      expect(init.headers.Authorization).toBe("Bearer test-access-token");
    }
    const tcCall = fetchMock.mock.calls[2];
    const tcBody = JSON.parse(tcCall[1].body);
    expect(tcBody.method).toBe("tools/call");
    expect(tcBody.params.name).toBe("1fate-analyze_saju");
    expect(tcBody.params.arguments.birth_date).toBe("1990-01-01");
    expect(tcCall[1].headers["Mcp-Session-Id"]).toBe("test-session-abc");
  }, 10_000);

  it("tools/call result.content 없으면 SchemaError", async () => {
    const { callTool } = await import("./playmcp-client");
    const { PlayMCPSchemaError } = await import("./errors");
    const sessionId = "test-session-bad";
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize") {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "mcp-session-id": sessionId }),
          text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
        } as unknown as Response;
      }
      if (body.method === "notifications/initialized") {
        return { ok: true, status: 202, headers: new Headers(), text: async () => "" } as unknown as Response;
      }
      // tools/call — content 누락
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () =>
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { unexpected: "shape" } })}\n\n`,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callTool("1fate-analyze_saju", { birth_date: "1990-01-01", gender: "male", calendar: "solar" }),
    ).rejects.toBeInstanceOf(PlayMCPSchemaError);
  }, 10_000);
});
