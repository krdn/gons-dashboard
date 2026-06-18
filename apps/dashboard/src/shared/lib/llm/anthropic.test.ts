// logLlmSpend — best-effort 토큰 관측 헬퍼.
//
// 회귀 가드(감사 P2 관찰성 sweep, PR #161 CI 실패 후):
//   관측이 분류/초안 주 경로를 절대 깨면 안 된다. usage가 누락/빈/malformed거나
//   logger가 실패해도 throw하지 않아야 한다(분류 결과를 뒤집으면 안 됨).
//   동시에 현실적 usage shape에서는 실제 토큰이 로깅돼야 한다(죽은 관측 방지).
import { describe, it, expect, vi, beforeEach } from "vitest";

// logger를 spy — emit 여부/내용 검증.
vi.mock("../log", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "../log";
import { logLlmSpend } from "./anthropic";

const mockInfo = vi.mocked(logger.info);

describe("logLlmSpend — best-effort 관찰성", () => {
  beforeEach(() => {
    mockInfo.mockClear();
  });

  // (1) malformed/누락 usage → throw 안 함 (주 경로 보호)
  it("usage=undefined여도 throw하지 않는다", () => {
    expect(() => logLlmSpend("reply-classify", "m", undefined)).not.toThrow();
  });

  it("usage=null이어도 throw하지 않는다", () => {
    expect(() => logLlmSpend("important-classify", "m", null)).not.toThrow();
  });

  it("usage={} (빈 객체)여도 throw하지 않고 0 토큰으로 로깅", () => {
    expect(() => logLlmSpend("reply-draft", "m", {})).not.toThrow();
    expect(mockInfo).toHaveBeenCalledWith("email-llm", "spend", {
      scope: "reply-draft",
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  // (2) 현실적 usage shape → 실제 토큰 로깅 (죽은 관측 방지 — advisor 함정)
  it("AI SDK usage(promptTokens/completionTokens) → 실제 토큰 로깅", () => {
    logLlmSpend("reply-classify", "claude-haiku-4-5", {
      promptTokens: 120,
      completionTokens: 45,
    });
    expect(mockInfo).toHaveBeenCalledWith("email-llm", "spend", {
      scope: "reply-classify",
      model: "claude-haiku-4-5",
      inputTokens: 120,
      outputTokens: 45,
    });
  });

  it("inputTokens/outputTokens 네이밍 usage도 정규화해 로깅", () => {
    logLlmSpend("important-classify", "claude-haiku-4-5", {
      inputTokens: 300,
      outputTokens: 80,
    });
    expect(mockInfo).toHaveBeenCalledWith("email-llm", "spend", {
      scope: "important-classify",
      model: "claude-haiku-4-5",
      inputTokens: 300,
      outputTokens: 80,
    });
  });
});
