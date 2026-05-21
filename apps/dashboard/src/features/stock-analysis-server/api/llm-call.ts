// LLM 호출 + JSON 추출 + Zod 검증 + 1회 retry.
// saju (narrative-server.ts) 의 동일 패턴 미러.
//
// Gotcha:
// 1. Opus 4.x 는 temperature 매개변수 거부 — proxy 가 400 응답.
//    모델 ID 에 'opus' 포함 시 temperature 생략.
// 2. Codex thinking block — content[0] 이 'thinking' 일 수 있어
//    find(b => b.type === "text") 로 안전 추출.
import "server-only";
import type { z } from "zod";
import { anthropic } from "@/shared/lib/llm/anthropic";
import type { BuiltPrompt } from "@gons/stock-analysis";

const MAX_TOKENS = 4096;

/**
 * LLM 응답에서 JSON object 만 추출 (markdown code fence / leading text 제거).
 */
export function extractJsonObject(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const inner = fenceMatch ? fenceMatch[1] : text;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in LLM response");
  }
  return inner.slice(start, end + 1);
}

/**
 * LLM 1회 호출 + JSON.parse + Zod 검증.
 * Opus 분기는 inline call 두 갈래로 — 인자 객체를 변수로 빼면 SDK overload 가
 * Stream union 으로 widening 돼 `content` 접근에서 TS2339 발생.
 */
export async function callLlmAndParse<T extends z.ZodTypeAny>(
  prompt: BuiltPrompt,
  modelId: string,
  schema: T,
): Promise<z.infer<T>> {
  const isOpus = modelId.includes("opus");
  const res = isOpus
    ? await anthropic.messages.create({
        model: modelId,
        max_tokens: MAX_TOKENS,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      })
    : await anthropic.messages.create({
        model: modelId,
        max_tokens: MAX_TOKENS,
        temperature: 0.5,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      });

  // Codex thinking block 회피 — 첫 블록이 'thinking' 이면 text 추출 실패.
  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`LLM response had no text block (model=${modelId})`);
  }
  const json = extractJsonObject(textBlock.text);
  const parsed: unknown = JSON.parse(json);
  return schema.parse(parsed);
}

/**
 * 재시도 wrapper — 기본 1회 retry (총 2회 시도).
 */
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
