import "server-only";
import type { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults } from "@/shared/lib/llm/anthropic";
import type { BuiltPrompt } from "@gons/stock-analysis";

const MAX_TOKENS = 4096;
// 구조 분석(페르소나/합의) 콜 타임아웃. gateway 기본값 300s 는 과다 —
// 단발 transient hang 이 retry 와 곱해져 최악 지연을 키운다.
const CALL_TIMEOUT_MS = 120_000;

export async function callLlmAndParse<T extends z.ZodTypeAny>(
  prompt: BuiltPrompt,
  modelId: string,
  schema: T,
): Promise<z.infer<T>> {
  const { object } = await analyzeStructured(prompt.user, schema, {
    ...gatewayDefaults,
    model: modelId,
    systemPrompt: prompt.system,
    maxOutputTokens: MAX_TOKENS,
    timeoutMs: CALL_TIMEOUT_MS,
  });
  return object;
}

/**
 * 재시도 가치가 있는 에러인지 판정.
 * 4xx 클라이언트 에러(429 rate limit 제외)·auth 실패는 같은 입력으로 다시 보내도
 * 결과가 같으므로 재시도하지 않는다 — 토큰·지연 낭비 방지.
 * 그 외(네트워크/타임아웃/5xx/JSON·zod 파싱 실패)는 transient 로 보고 재시도.
 *
 * ai-sdk APICallError 는 dashboard 직접 의존성이 아니므로(@krdn/llm-gateway 의 transitive)
 * 클래스 import 대신 statusCode/isRetryable 필드를 duck-typing 으로 안전하게 읽는다.
 */
function shouldRetry(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { isRetryable?: unknown; statusCode?: unknown };
    if (typeof e.isRetryable === "boolean") return e.isRetryable;
    if (typeof e.statusCode === "number") {
      if (e.statusCode === 429) return true; // rate limit — backoff 후 재시도 가치
      if (e.statusCode >= 400 && e.statusCode < 500) return false; // 그 외 4xx 는 영구 실패
    }
  }
  return true;
}

export async function callLlmAndParseWithRetry<T extends z.ZodTypeAny>(
  prompt: BuiltPrompt,
  modelId: string,
  schema: T,
  maxRetries = 1,
): Promise<z.infer<T>> {
  let lastError: Error | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await callLlmAndParse(prompt, modelId, schema);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!shouldRetry(err)) break; // 영구 실패 — 재시도 무의미
    }
  }
  throw new Error(
    `LLM call failed after ${maxRetries + 1} attempts (model=${modelId}): ${lastError?.message ?? "unknown error"}`,
  );
}
