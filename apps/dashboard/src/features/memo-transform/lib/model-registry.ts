import "server-only";
import { env } from "@/shared/config/env";
import type { MemoModelKey, MemoModelSelection } from "@/entities/memo/server";

/**
 * 안정적인 DB 키를 cli-proxy-api가 라우팅할 실제 모델 ID로 변환한다.
 * 호출 자체는 transform-memo의 gatewayDefaults(provider=claude-cli, baseUrl)로 단일 프록시를 탄다.
 */
export function resolveMemoModelId(key: MemoModelKey): string {
  switch (key) {
    case "claude":
      return env.MEMO_LLM_MODEL_CLAUDE;
    case "codex":
      return env.MEMO_LLM_MODEL_CODEX;
    case "gemini":
      return env.MEMO_LLM_MODEL_GEMINI;
  }
}

export function resolveMemoModelSelection(
  model: MemoModelKey,
  modelId: string | null,
): MemoModelSelection {
  return { model, modelId: modelId ?? resolveMemoModelId(model) };
}
