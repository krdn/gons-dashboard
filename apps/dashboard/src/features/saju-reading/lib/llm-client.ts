import "server-only";
import { analyzeText, normalizeUsage } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults } from "@/shared/lib/llm/anthropic";
import { env } from "@/shared/config/env";

const PRICING_USD_PER_M = {
  "claude-opus-4-7":           { input: 15,   output: 75 },
  "claude-sonnet-4-6":         { input:  3,   output: 15 },
  "claude-haiku-4-5-20251001": { input:  0.8, output:  4 },
} as const;

const USD_TO_KRW = 1380;

export interface LlmCallResult {
  body: string;
  inputTokens: number;
  outputTokens: number;
  krw: number;
  model: string;
}

export interface LlmCallInput {
  system: string;
  user: string;
  maxTokens: number;
}

export async function callSajuLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const model = env.SAJU_LLM_MODEL;
  const { text, usage } = await analyzeText(input.user, {
    ...gatewayDefaults,
    model,
    maxOutputTokens: input.maxTokens,
    systemPrompt: input.system,
  });

  if (!text) throw new Error("callSajuLlm: empty response body");

  const { inputTokens, outputTokens } = normalizeUsage(usage);
  const pricing =
    PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M] ?? PRICING_USD_PER_M["claude-opus-4-7"];
  const usd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  const krw = Math.round(usd * USD_TO_KRW * 100) / 100;

  return { body: text, inputTokens, outputTokens, krw, model };
}
