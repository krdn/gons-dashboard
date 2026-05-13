import "server-only";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { env } from "@/shared/config/env";

// 2026-05 기준 (USD per 1M tokens). 모델 가격 갱신 시 한 곳만 수정.
const PRICING_USD_PER_M = {
  "claude-opus-4-7":           { input: 15,   output: 75 },
  "claude-sonnet-4-6":         { input:  3,   output: 15 },
  "claude-haiku-4-5-20251001": { input:  0.8, output:  4 },
} as const;

const USD_TO_KRW = 1380; // 정확한 회계 아니라 일별 가드용 추정

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

// Opus 4.x 계열은 temperature 매개변수가 deprecated — 보내면 400.
// 모델 이름이 'claude-opus-4' 로 시작하면 temperature 생략.
function supportsTemperature(model: string): boolean {
  return !model.startsWith("claude-opus-4");
}

export async function callSajuLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const model = env.SAJU_LLM_MODEL;
  const response = await anthropic.messages.create({
    model,
    max_tokens: input.maxTokens,
    ...(supportsTemperature(model) ? { temperature: env.SAJU_LLM_TEMPERATURE } : {}),
    system: input.system,
    messages: [{ role: "user", content: input.user }],
  });

  const body = response.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("")
    .trim();

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const pricing =
    PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M] ?? PRICING_USD_PER_M["claude-opus-4-7"];
  const usd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  const krw = Math.round(usd * USD_TO_KRW * 100) / 100;

  if (!body) throw new Error("callSajuLlm: empty response body");

  return { body, inputTokens, outputTokens, krw, model };
}
