// 저장된 메모 → 프리셋 스타일 변환. cleanup-transcript 패턴 미러 (2층 프롬프트).
// 온디맨드 + 미리보기 승인 흐름이라 raw-fallback 저장은 없다 — 실패는 failed로 반환만.
import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults, logLlmSpend } from "@/shared/lib/llm/anthropic";
import { isRefusalDraft } from "@/shared/lib/llm/draft-reply";
import { isDegenerateCleanup } from "@/features/memo-compose/lib/cleanup-transcript";
import type { TransformPresetId } from "@/entities/memo/client";
import { TRANSFORM_PRESETS } from "./preset-meta";
import { GUARDRAIL_PROMPT, PRESET_INSTRUCTIONS } from "./prompts";

const MAX_INPUT = 4_000;
export const TRANSFORM_MODEL = "claude-sonnet-5";

export const TransformResponseSchema = z.object({
  content: z.string().min(1).max(30_000),
});

export type TransformOutcome =
  | { kind: "ok"; content: string }
  | { kind: "failed"; reason: string };

export async function transformMemoContent(
  input: string,
  preset: TransformPresetId,
): Promise<TransformOutcome> {
  const text = input.trim();
  if (text.length === 0) return { kind: "failed", reason: "empty-input" };
  const truncated = text.slice(0, MAX_INPUT);

  try {
    const { object, usage } = await analyzeStructured(truncated, TransformResponseSchema, {
      ...gatewayDefaults,
      model: TRANSFORM_MODEL,
      systemPrompt: `${GUARDRAIL_PROMPT}\n\n${PRESET_INSTRUCTIONS[preset]}`,
      maxOutputTokens: 4_000,
    });

    // 관측은 best-effort — 변환 결과를 절대 뒤집지 않는다.
    try {
      logLlmSpend(`memo-transform:${preset}`, TRANSFORM_MODEL, usage);
    } catch {
      /* swallow */
    }

    const content = object.content.trim();
    if (content.length === 0) return { kind: "failed", reason: "empty-output" };
    if (isRefusalDraft(content)) return { kind: "failed", reason: "refusal" };
    if (TRANSFORM_PRESETS[preset].strictPreserve && isDegenerateCleanup(truncated, content)) {
      return { kind: "failed", reason: "degenerate" };
    }
    return { kind: "ok", content };
  } catch (e) {
    return { kind: "failed", reason: e instanceof Error ? e.message : "llm-error" };
  }
}
