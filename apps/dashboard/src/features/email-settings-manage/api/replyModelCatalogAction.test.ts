import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, resolveReplyModelIdMock, loadProviderModelCatalogMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    resolveReplyModelIdMock: vi.fn(),
    loadProviderModelCatalogMock: vi.fn(),
  }));

vi.mock("@/shared/lib/auth", () => ({ auth: authMock }));
vi.mock("@/shared/lib/llm/reply-model-registry", () => ({
  resolveReplyModelId: resolveReplyModelIdMock,
}));
vi.mock("@/shared/lib/llm/provider-model-catalog-server", () => ({
  loadProviderModelCatalog: loadProviderModelCatalogMock,
}));

import { replyModelCatalogAction } from "./replyModelCatalogAction";

const ids = {
  gemini: "gemini-2.5-pro",
  codex: "gpt-5.5",
  claude: "claude-opus-4-8",
};

beforeEach(() => {
  authMock.mockReset();
  resolveReplyModelIdMock.mockReset();
  loadProviderModelCatalogMock.mockReset();
  resolveReplyModelIdMock.mockImplementation((key: keyof typeof ids) =>
    Promise.resolve(ids[key]),
  );
  loadProviderModelCatalogMock.mockResolvedValue({
    source: "live",
    catalog: {
      gemini: [ids.gemini],
      codex: [ids.codex],
      claude: [ids.claude],
    },
  });
});

describe("replyModelCatalogAction", () => {
  it("인증되지 않은 요청은 registry와 proxy를 호출하지 않는다", async () => {
    authMock.mockResolvedValue(null);
    await expect(replyModelCatalogAction()).resolves.toBeNull();
    expect(resolveReplyModelIdMock).not.toHaveBeenCalled();
    expect(loadProviderModelCatalogMock).not.toHaveBeenCalled();
  });

  it("always와 Haiku 제외 정책을 공통 로더에 전달한다", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    await replyModelCatalogAction();
    expect(loadProviderModelCatalogMock).toHaveBeenCalledWith({
      defaults: {
        gemini: "gemini-2.5-pro",
        codex: "gpt-5.5",
        claude: "claude-opus-4-8",
      },
      defaultMode: "always",
      allow: { claude: expect.any(Function) },
    });
    const passedPolicy = loadProviderModelCatalogMock.mock.calls[0][0];
    expect(passedPolicy.allow.claude("claude-haiku-4-5")).toBe(false);
    expect(passedPolicy.allow.claude("claude-opus-4-8")).toBe(true);
  });
});
