import "server-only";
import { normalizeUsage, type AIGatewayOptions } from "@krdn/llm-gateway/gateway";
import { env } from "@/shared/config/env";
import { logger } from "../log";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export const gatewayDefaults: Pick<AIGatewayOptions, "provider" | "baseUrl" | "apiKey"> = {
  provider: "claude-cli",
  baseUrl: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
};

/**
 * 이메일 LLM 호출당 토큰 비용 관측 — best-effort 1줄 emit.
 *
 * 관측은 절대 주 경로(분류·초안)를 깨면 안 된다: usage가 누락/빈/malformed거나
 * logger가 실패해도 swallow하고 호출자는 정상 진행한다. (게이트웨이가 usage를
 * 생략하거나 빈 객체로 줄 수 있음 — normalizeUsage는 그 경우 0을 반환하도록
 * 설계됐지만, 방어 심층으로 전체를 try/catch.)
 *
 * 예산 게이트·krw 환산은 의도적으로 제외(YAGNI) — raw 토큰+model+scope만 로그,
 * 일 합산은 docker logs | jq.
 */
export function logLlmSpend(
  scope: "reply-classify" | "important-classify" | "reply-draft",
  model: string,
  usage: Record<string, unknown> | undefined | null,
): void {
  try {
    const { inputTokens, outputTokens } = normalizeUsage(usage);
    logger.info("email-llm", "spend", { scope, model, inputTokens, outputTokens });
  } catch {
    // 관측 실패는 무시 — 분류/초안 결과를 절대 뒤집지 않는다.
  }
}
