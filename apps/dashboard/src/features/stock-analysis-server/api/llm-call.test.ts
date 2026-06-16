import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
}));

import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { callLlmAndParse, callLlmAndParseWithRetry } from "./llm-call";
import type { BuiltPrompt } from "@gons/stock-analysis";

const mockAnalyze = vi.mocked(analyzeStructured);

const SCHEMA = z.object({ verdict: z.string() });
const PROMPT: BuiltPrompt = { system: "sys", user: "usr" } as BuiltPrompt;

// ai-sdk APICallError 형태 — duck-typing 으로 읽는 필드만 채운다.
function apiError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`http ${statusCode}`), { statusCode });
}
function retryableFlagError(isRetryable: boolean): Error & {
  isRetryable: boolean;
} {
  return Object.assign(new Error("flagged"), { isRetryable });
}

beforeEach(() => {
  mockAnalyze.mockReset();
});

describe("callLlmAndParse", () => {
  it("성공 시 object 반환 + 구조분석 timeout(120s) 전달", async () => {
    mockAnalyze.mockResolvedValueOnce({
      object: { verdict: "BUY" },
      usage: undefined,
      finishReason: "stop",
    } as never);

    const result = await callLlmAndParse(PROMPT, "claude-opus-4-8", SCHEMA);

    expect(result).toEqual({ verdict: "BUY" });
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    // 300s gateway 기본값이 아니라 명시 120s 전달 — retry×timeout 증폭 완화
    expect(mockAnalyze.mock.calls[0]![2]).toMatchObject({
      model: "claude-opus-4-8",
      timeoutMs: 120_000,
    });
  });
});

describe("callLlmAndParseWithRetry — shouldRetry 가드", () => {
  it("첫 호출 성공 시 1회만 호출", async () => {
    mockAnalyze.mockResolvedValueOnce({
      object: { verdict: "HOLD" },
    } as never);

    const result = await callLlmAndParseWithRetry(
      PROMPT,
      "m",
      SCHEMA,
    );

    expect(result).toEqual({ verdict: "HOLD" });
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
  });

  it("4xx(400) 영구 실패는 재시도하지 않음 — 1회만", async () => {
    mockAnalyze.mockRejectedValue(apiError(400));

    await expect(
      callLlmAndParseWithRetry(PROMPT, "m", SCHEMA),
    ).rejects.toThrow(/after 2 attempts/);

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
  });

  it("401 auth 실패도 재시도하지 않음 — 1회만", async () => {
    mockAnalyze.mockRejectedValue(apiError(401));

    await expect(
      callLlmAndParseWithRetry(PROMPT, "m", SCHEMA),
    ).rejects.toThrow();

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
  });

  it("429 rate limit 은 재시도 — maxRetries+1회", async () => {
    mockAnalyze.mockRejectedValue(apiError(429));

    await expect(
      callLlmAndParseWithRetry(PROMPT, "m", SCHEMA, 1),
    ).rejects.toThrow();

    expect(mockAnalyze).toHaveBeenCalledTimes(2);
  });

  it("5xx 서버 에러는 재시도 — maxRetries+1회", async () => {
    mockAnalyze.mockRejectedValue(apiError(503));

    await expect(
      callLlmAndParseWithRetry(PROMPT, "m", SCHEMA, 1),
    ).rejects.toThrow();

    expect(mockAnalyze).toHaveBeenCalledTimes(2);
  });

  it("타임아웃(statusCode 없는 일반 Error)은 재시도 — transient 취급", async () => {
    mockAnalyze.mockRejectedValue(new Error("timeout"));

    await expect(
      callLlmAndParseWithRetry(PROMPT, "m", SCHEMA, 1),
    ).rejects.toThrow();

    expect(mockAnalyze).toHaveBeenCalledTimes(2);
  });

  it("isRetryable=false 플래그를 statusCode 보다 우선 — 재시도 안 함", async () => {
    mockAnalyze.mockRejectedValue(retryableFlagError(false));

    await expect(
      callLlmAndParseWithRetry(PROMPT, "m", SCHEMA, 1),
    ).rejects.toThrow();

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
  });

  it("재시도 후 성공하면 정상 반환", async () => {
    mockAnalyze
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce({ object: { verdict: "SELL" } } as never);

    const result = await callLlmAndParseWithRetry(PROMPT, "m", SCHEMA, 1);

    expect(result).toEqual({ verdict: "SELL" });
    expect(mockAnalyze).toHaveBeenCalledTimes(2);
  });
});
