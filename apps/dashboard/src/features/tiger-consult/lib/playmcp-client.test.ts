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

describe("callTool", () => {
  it("Authorization Bearer 헤더 + JSON body 포함", async () => {
    const { callTool } = await import("./playmcp-client");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { profile: { nickname_full: "x" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await callTool("1fate-analyze_saju", {
      birth_date: "1990-01-01", gender: "male", calendar: "solar",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-access-token");
    const body = JSON.parse(init.body);
    expect(body.tool).toBe("1fate-analyze_saju");
    expect(body.params.birth_date).toBe("1990-01-01");
  });

  it("응답에 result 필드 없으면 SchemaError", async () => {
    const { callTool } = await import("./playmcp-client");
    const { PlayMCPSchemaError } = await import("./errors");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "structure" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callTool("1fate-analyze_saju", { birth_date: "1990-01-01", gender: "male", calendar: "solar" }),
    ).rejects.toBeInstanceOf(PlayMCPSchemaError);
  });
});
