import { beforeEach, describe, expect, it, vi } from "vitest";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock("@/shared/config/env", () => ({
  env: {
    ANTHROPIC_BASE_URL: "http://proxy.test",
    ANTHROPIC_API_KEY: "test-api-key",
  },
}));
vi.mock("@/shared/lib/log", () => ({
  logger: { warn: warnMock },
}));

import { loadProviderModelCatalog } from "./provider-model-catalog-server";

const policy = {
  defaults: {
    claude: "claude-sonnet-5",
    codex: "gpt-5.5",
    gemini: "gemini-2.5-pro",
  },
  defaultMode: "always" as const,
};

beforeEach(() => {
  vi.restoreAllMocks();
  warnMock.mockClear();
});

describe("loadProviderModelCatalog HTTP source", () => {
  it("HTTP 실패를 본문·URL·키 없이 기록하고 fallback한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("secret response body", { status: 503 }),
    );

    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "http", status: 503 },
    );
    const logs = JSON.stringify(warnMock.mock.calls);
    expect(logs).not.toContain("test-api-key");
    expect(logs).not.toContain("secret response body");
    expect(logs).not.toContain("proxy.test");
  });

  it("timeout을 분류한다", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenLastCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "timeout" },
    );
  });

  it("깨진 JSON을 분류한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{", { status: 200 }),
    );
    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenLastCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "invalid-json", status: 200 },
    );
  });

  it("빈 모델 목록을 분류한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ data: [] }),
    );
    await expect(loadProviderModelCatalog(policy)).resolves.toMatchObject({
      source: "fallback",
    });
    expect(warnMock).toHaveBeenLastCalledWith(
      "provider-model-catalog",
      "source-fallback",
      { reason: "empty" },
    );
  });
});
