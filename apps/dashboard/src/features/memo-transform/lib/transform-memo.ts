// 저장된 메모 → 프리셋 스타일 변환. cleanup-transcript 패턴 미러 (3층 프롬프트).
// 온디맨드 + 미리보기 승인 흐름이라 raw-fallback 저장은 없다 — 실패는 failed로 반환만.
import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults, logLlmSpend } from "@/shared/lib/llm/anthropic";
import { isRefusalDraft } from "@/shared/lib/llm/draft-reply";
import { isDegenerateCleanup } from "@/features/memo-compose/lib/cleanup-transcript";
import { buildTransformSystemPrompt } from "./prompts";
import type { ResolvedPreset } from "./preset-resolver";

const MAX_INPUT = 4_000;
export const TransformResponseSchema = z.object({
  content: z.string().min(1).max(30_000),
});

export type TransformOutcome =
  | { kind: "ok"; content: string }
  | { kind: "failed"; reason: string };

export function isModelUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /auth_unavailable|no auth available|model not found/i.test(error.message)
  );
}

export async function transformMemoContent(
  input: string,
  preset: ResolvedPreset,
): Promise<TransformOutcome> {
  const text = input.trim();
  if (text.length === 0) return { kind: "failed", reason: "empty-input" };
  const truncated = text.slice(0, MAX_INPUT);
  const metricKey: `memo-transform:${string}` = `memo-transform:${preset.isBuiltin ? preset.slug : "custom"}`;
  const model = preset.modelId;

  try {
    const { object, usage } = await analyzeStructured(
      truncated,
      TransformResponseSchema,
      {
        ...gatewayDefaults,
        model,
        systemPrompt: buildTransformSystemPrompt(
          preset.instruction,
          preset.fidelityGuard,
        ),
        maxOutputTokens: 4_000,
      },
    );

    // 관측은 best-effort — 변환 결과를 절대 뒤집지 않는다.
    try {
      logLlmSpend(metricKey, model, usage);
    } catch {
      /* swallow */
    }

    const content = object.content.trim();
    if (content.length === 0) return { kind: "failed", reason: "empty-output" };
    if (isRefusalDraft(content)) return { kind: "failed", reason: "refusal" };
    if (preset.strictPreserve && isDegenerateCleanup(truncated, content)) {
      return { kind: "failed", reason: "degenerate" };
    }
    return { kind: "ok", content };
  } catch (e) {
    // e.message는 게이트웨이 URL 등 내부 정보를 담을 수 있어 클라이언트 경계를 넘기지 않는다.
    console.error(`[${metricKey}] LLM 호출 실패`, e);
    if (isModelUnavailableError(e)) {
      return { kind: "failed", reason: "model-unavailable" };
    }
    return { kind: "failed", reason: "llm-error" };
  }
}
