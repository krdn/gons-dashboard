import "server-only";
import type { AIGatewayOptions } from "@krdn/llm-gateway/gateway";
import { env } from "@/shared/config/env";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export const gatewayDefaults: Pick<AIGatewayOptions, "provider" | "baseUrl" | "apiKey"> = {
  provider: "claude-cli",
  baseUrl: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
};
