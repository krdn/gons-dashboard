import "server-only";
import type { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults } from "@/shared/lib/llm/anthropic";
import type { BuiltPrompt } from "@gons/stock-analysis";

const MAX_TOKENS = 4096;

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
  });
  return object;
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
    }
  }
  throw new Error(
    `LLM call failed after ${maxRetries + 1} attempts (model=${modelId}): ${lastError?.message ?? "unknown error"}`,
  );
}
