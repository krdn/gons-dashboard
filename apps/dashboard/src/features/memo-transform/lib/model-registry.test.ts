import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/config/env", () => ({
  env: {
    MEMO_LLM_MODEL_CLAUDE: "claude-proxy-model",
    MEMO_LLM_MODEL_CODEX: "codex-proxy-model",
    MEMO_LLM_MODEL_GEMINI: "gemini-proxy-model",
  },
}));

import {
  resolveMemoModelId,
  resolveMemoModelSelection,
} from "./model-registry";

describe("resolveMemoModelId", () => {
  it.each([
    ["claude", "claude-proxy-model"],
    ["codex", "codex-proxy-model"],
    ["gemini", "gemini-proxy-model"],
  ] as const)("%s 키를 프록시 모델 ID로 해석한다", (key, expected) => {
    expect(resolveMemoModelId(key)).toBe(expected);
  });

  it("상세 모델 ID가 있으면 env 기본값 대신 그대로 사용한다", () => {
    expect(resolveMemoModelSelection("claude", "claude-opus-4-8")).toEqual({
      model: "claude",
      modelId: "claude-opus-4-8",
    });
  });
});
