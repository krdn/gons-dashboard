import "server-only";
import { analyzeText, normalizeUsage } from "@krdn/llm-gateway/gateway";
import { resolveLatestModel } from "@/shared/lib/llm/resolve-latest-model";
import { gatewayDefaults } from "@/shared/lib/llm/anthropic";
import { computeKrw } from "@/shared/lib/llm/pricing";

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
  const model = await resolveLatestModel("opus");
  const { text, usage } = await analyzeText(input.user, {
    ...gatewayDefaults,
    model,
    maxOutputTokens: input.maxTokens,
    systemPrompt: input.system,
  });

  if (!text) throw new Error("callSajuLlm: empty response body");

  // 단가표·환산 로직은 shared/lib/llm/pricing 의 computeKrw 단일 출처로 통합.
  // callSajuLlm 은 resolveLatestModel("opus") 로 Claude opus 만 쓰므로 sonnet/haiku/opus 만
  // 필요하고, computeKrw 가 그 superset(gemini/codex 추가) 을 모두 커버한다.
  const { inputTokens, outputTokens } = normalizeUsage(usage);
  const krw = computeKrw(model, inputTokens, outputTokens);

  return { body: text, inputTokens, outputTokens, krw, model };
}
