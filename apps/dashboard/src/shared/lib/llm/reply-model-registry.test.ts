import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/config/env", () => ({
  env: {
    REPLY_LLM_MODEL_GEMINI: "gemini-test-id",
    REPLY_LLM_MODEL_CODEX: "codex-test-id",
  },
}));

vi.mock("./resolve-claude-model", () => ({
  resolveClaudeModel: vi.fn(async () => "claude-opus-resolved"),
}));

import { resolveReplyModelId } from "./reply-model-registry";

describe("resolveReplyModelId", () => {
  it("gemini → env 값", async () => {
    expect(await resolveReplyModelId("gemini")).toBe("gemini-test-id");
  });
  it("codex → env 값", async () => {
    expect(await resolveReplyModelId("codex")).toBe("codex-test-id");
  });
  it("claude → resolveClaudeModel() (opus, haiku 아님)", async () => {
    expect(await resolveReplyModelId("claude")).toBe("claude-opus-resolved");
  });
});
