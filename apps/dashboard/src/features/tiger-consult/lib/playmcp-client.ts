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

// MCP protocol — 매 호출마다 initialize → tools/call 의 2-step 흐름.
// PlayMCP gateway는 Streamable HTTP transport이고 Mcp-Session-Id 헤더가 필수.
// 세션은 호출 단위로 새로 발급 (호출 간 상태 공유 없음, cross-talk 회피와도 일관).
const MCP_PROTOCOL_VERSION = "2025-03-26";
const CLIENT_NAME = "gons-dashboard-tiger";
const CLIENT_VERSION = "0.1.0";

export async function callTool<T>(toolName: ToolName, params: Record<string, unknown>): Promise<T> {
  return playmcpLimit(async () => {
    await sleep(JITTER_MIN_MS + Math.random() * JITTER_RANGE_MS);
    const token = await ensureAccessToken();
    const url = env.PLAYMCP_GATEWAY_URL;
    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    // Step 1: initialize → Mcp-Session-Id 헤더 수신
    const initResponse = await playmcpFetch(url, baseHeaders, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      },
    }, toolName);
    const sessionId = initResponse.headers.get("mcp-session-id");
    if (!sessionId) {
      throw new PlayMCPSchemaError(`initialize 응답에 Mcp-Session-Id 헤더 없음 (tool=${toolName})`);
    }
    await initResponse.text().catch(() => "");

    const sessionHeaders = { ...baseHeaders, "Mcp-Session-Id": sessionId };

    // Step 2: notifications/initialized — id 없음, 응답 202 expected
    await playmcpFetch(url, sessionHeaders, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }, toolName).then((r) => r.text().catch(() => ""));

    // Step 3: tools/call → SSE 응답 (data: {...})
    const callResponse = await playmcpFetch(url, sessionHeaders, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: params },
    }, toolName);

    const bodyText = await callResponse.text();
    const envelope = parseSseOrJson(bodyText, toolName);
    if (envelope.error) {
      throw new PlayMCPInputError(
        `JSON-RPC error ${envelope.error.code}: ${envelope.error.message} (tool=${toolName})`,
      );
    }
    const result = envelope.result;
    if (!result || typeof result !== "object") {
      throw new PlayMCPSchemaError(`tools/call 응답에 result 필드 없음 (tool=${toolName})`);
    }
    // MCP 표준: result.content[0].text 안에 실제 PlayMCP 도구 응답 JSON string.
    // isError=true 면 text 는 plain 에러 메시지 (JSON 아님) — InputError 로 노출.
    const resultObj = result as { content?: unknown[]; isError?: boolean };
    const content = resultObj.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new PlayMCPSchemaError(`tools/call result.content 없음 (tool=${toolName})`);
    }
    const first = content[0] as { type?: string; text?: string };
    if (first.type !== "text" || typeof first.text !== "string") {
      throw new PlayMCPSchemaError(`tools/call content[0] 형식 예상 외 (tool=${toolName}, type=${first.type})`);
    }
    if (resultObj.isError === true) {
      throw new PlayMCPInputError(
        `PlayMCP tool error (${toolName}): ${first.text.slice(0, 300)}`,
      );
    }
    let toolPayload: unknown;
    try {
      toolPayload = JSON.parse(first.text);
    } catch (err) {
      throw new PlayMCPSchemaError(
        `tools/call content[0].text JSON parse 실패 (tool=${toolName}): ${(err as Error).message}`,
      );
    }
    // PlayMCP 도구 응답 자체가 {error: "..."} 형태일 때 (예: daily 의 NameError):
    // isError 플래그 없이 plain JSON 으로 도구 측 실패 신호. InputError 로 정규화.
    if (
      toolPayload &&
      typeof toolPayload === "object" &&
      !("result" in toolPayload) &&
      "error" in toolPayload
    ) {
      const errMsg = (toolPayload as { error: unknown }).error;
      throw new PlayMCPInputError(
        `PlayMCP tool error (${toolName}): ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)}`,
      );
    }
    return toolPayload as T;
  });
}

async function playmcpFetch(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  toolName: ToolName,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PlayMCPNetworkError(`PlayMCP fetch failed for ${toolName} (${body.method})`, err);
  }
  if (!response.ok && response.status !== 202) {
    const bodyText = await response.text().catch(() => "<no body>");
    if (response.status === 401 || response.status === 403) {
      throw new PlayMCPAuthError(`${response.status} ${response.statusText}`, { recoverable: true });
    }
    if (response.status === 400 || response.status === 422) {
      throw new PlayMCPInputError(`${response.status}: ${bodyText.slice(0, 200)}`);
    }
    throw new PlayMCPNetworkError(
      `${response.status} ${response.statusText}: ${bodyText.slice(0, 200)}`,
    );
  }
  return response;
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// PlayMCP는 tools/call 응답으로 SSE 형식 (event: message\ndata: {...}) 을 반환.
// initialize 응답은 plain JSON 또는 SSE 둘 다 가능 (구현 의존).
function parseSseOrJson(bodyText: string, toolName: ToolName): JsonRpcEnvelope {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    throw new PlayMCPSchemaError(`응답 본문 비어있음 (tool=${toolName})`);
  }
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const dataLine = trimmed
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new PlayMCPSchemaError(`SSE 응답에 data 라인 없음 (tool=${toolName})`);
    }
    const jsonStr = dataLine.slice("data:".length).trim();
    try {
      return JSON.parse(jsonStr) as JsonRpcEnvelope;
    } catch (err) {
      throw new PlayMCPSchemaError(`SSE data JSON parse 실패 (tool=${toolName}): ${(err as Error).message}`);
    }
  }
  try {
    return JSON.parse(trimmed) as JsonRpcEnvelope;
  } catch (err) {
    throw new PlayMCPSchemaError(`응답 JSON parse 실패 (tool=${toolName}): ${(err as Error).message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
