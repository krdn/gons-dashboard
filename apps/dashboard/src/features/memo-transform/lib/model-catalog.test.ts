import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadProviderModelCatalogMock } = vi.hoisted(() => ({
  loadProviderModelCatalogMock: vi.fn(),
}));

vi.mock("@/shared/config/env", () => ({
  env: {
    MEMO_LLM_MODEL_CLAUDE: "claude-sonnet-5",
    MEMO_LLM_MODEL_CODEX: "gpt-5.5",
    MEMO_LLM_MODEL_GEMINI: "gemini-pro-latest",
  },
}));
vi.mock("@/shared/lib/llm/provider-model-catalog-server", () => ({
  loadProviderModelCatalog: loadProviderModelCatalogMock,
}));

import {
  getMemoModelAvailability,
  loadMemoModelCatalog,
} from "./model-catalog";

const catalog = {
  claude: ["claude-sonnet-5"],
  codex: ["gpt-5.5"],
  gemini: ["gemini-pro-latest"],
};

beforeEach(() => loadProviderModelCatalogMock.mockReset());

describe("memo model catalog adapter", () => {
  it("env 기본값과 source-failure-only 정책을 전달한다", async () => {
    loadProviderModelCatalogMock.mockResolvedValue({ source: "live", catalog });
    await loadMemoModelCatalog();
    expect(loadProviderModelCatalogMock).toHaveBeenCalledWith({
      defaults: {
        claude: "claude-sonnet-5",
        codex: "gpt-5.5",
        gemini: "gemini-pro-latest",
      },
      defaultMode: "source-failure-only",
    });
  });

  it("live 누락은 unavailable, fallback 누락은 unknown이다", async () => {
    loadProviderModelCatalogMock
      .mockResolvedValueOnce({ source: "live", catalog })
      .mockResolvedValueOnce({ source: "fallback", catalog });
    const selection = { model: "codex" as const, modelId: "gpt-5.6-luna" };
    await expect(getMemoModelAvailability(selection)).resolves.toBe(
      "unavailable",
    );
    await expect(getMemoModelAvailability(selection)).resolves.toBe("unknown");
  });
});
