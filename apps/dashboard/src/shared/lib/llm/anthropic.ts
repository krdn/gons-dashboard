import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AIGatewayOptions } from "@krdn/llm-gateway/gateway";
import { env } from "@/shared/config/env";

// Anthropic SDK 클라이언트 — saju-reading 가격 추적이 직접 사용.
export const anthropic = new Anthropic({
  baseURL: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
});

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// llm-gateway 기본 옵션 — CLI Proxy 경유.
export const gatewayDefaults: Pick<AIGatewayOptions, "provider" | "baseUrl" | "apiKey"> = {
  provider: "claude-cli",
  baseUrl: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
};
