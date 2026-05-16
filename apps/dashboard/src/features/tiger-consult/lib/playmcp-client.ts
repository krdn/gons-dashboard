import "server-only";
import pLimit from "p-limit";
import { env } from "@/shared/config/env";
import { ensureAccessToken } from "./playmcp-credentials";
import { PlayMCPNetworkError, PlayMCPAuthError, PlayMCPInputError, PlayMCPSchemaError } from "./errors";

export type ToolName =
  | "1fate-analyze_saju"
  | "1fate-get_year_fortune"
  | "1fate-get_daily_fortune"
  | "1fate-check_compatibility";

// 동시 호출 시 PlayMCP 서버 측 cross-talk 위험 (1차 실증) → concurrency=1.
const playmcpLimit = pLimit(1);

// 1.5~2.0 s jitter — 직전 호출 응답 전부 도달 보장 + 시간 변동성으로
// 캐시 키 충돌 회피.
const JITTER_MIN_MS = 1500;
const JITTER_RANGE_MS = 500;

const CALL_TIMEOUT_MS = 30_000;

export async function callTool<T>(toolName: ToolName, params: Record<string, unknown>): Promise<T> {
  return playmcpLimit(async () => {
    await sleep(JITTER_MIN_MS + Math.random() * JITTER_RANGE_MS);
    const token = await ensureAccessToken();
    const url = env.PLAYMCP_GATEWAY_URL;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tool: toolName, params }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PlayMCPNetworkError(`PlayMCP fetch failed for ${toolName}`, err);
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<no body>");
      if (response.status === 401 || response.status === 403) {
        throw new PlayMCPAuthError(`${response.status} ${response.statusText}`, { recoverable: true });
      }
      if (response.status === 400 || response.status === 422) {
        throw new PlayMCPInputError(`${response.status}: ${bodyText.slice(0, 200)}`);
      }
      throw new PlayMCPNetworkError(`${response.status} ${response.statusText}: ${bodyText.slice(0, 200)}`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new PlayMCPSchemaError(`응답 JSON parse 실패: ${(err as Error).message}`);
    }
    if (!json || typeof json !== "object" || !("result" in json)) {
      throw new PlayMCPSchemaError(`응답에 result 필드 없음`);
    }
    return json as T;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
