import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/config/env", () => ({
  env: {
    ANTHROPIC_BASE_URL: "http://proxy.test",
    ANTHROPIC_API_KEY: "test-key",
    MEMO_LLM_MODEL_CLAUDE: "claude-sonnet-5",
    MEMO_LLM_MODEL_CODEX: "gpt-5.5",
    MEMO_LLM_MODEL_GEMINI: "gemini-pro-latest",
  },
}));

import { buildMemoModelCatalog, listMemoModelCatalog } from "./model-catalog";

describe("memo model catalog", () => {
  it("프록시 모델 ID를 공급사별로 분류하고 env 기본값을 첫 항목으로 둔다", () => {
    expect(
      buildMemoModelCatalog([
        "claude-opus-4-8",
        "claude-haiku-4-5",
        "gpt-5.4",
        "o3-pro",
        "gemini-3.1-pro",
        "unrelated-model",
      ]),
    ).toEqual({
      claude: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
      codex: ["gpt-5.5", "o3-pro", "gpt-5.4"],
      gemini: ["gemini-pro-latest", "gemini-3.1-pro"],
    });
  });

  it("프록시 /v1/models 결과를 사용한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "claude-opus-4-8" }] }), {
        status: 200,
      }),
    );
    const catalog = await listMemoModelCatalog();
    expect(fetch).toHaveBeenCalledWith(
      "http://proxy.test/v1/models",
      expect.objectContaining({ headers: { "x-api-key": "test-key" } }),
    );
    expect(catalog.claude).toContain("claude-opus-4-8");
  });

  it("프록시 조회 실패 시 env 기본 모델만 반환한다", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    await expect(listMemoModelCatalog()).resolves.toEqual({
      claude: ["claude-sonnet-5"],
      codex: ["gpt-5.5"],
      gemini: ["gemini-pro-latest"],
    });
  });

  it("실행 직전 모델이 현재 목록에서 사라졌는지 판별한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "gpt-5.5" }] }), {
        status: 200,
      }),
    );
    const { isMemoModelCurrentlyAvailable } = await import("./model-catalog");
    await expect(isMemoModelCurrentlyAvailable("gpt-5.6-luna")).resolves.toBe(
      false,
    );
  });
});
