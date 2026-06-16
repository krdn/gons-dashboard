// 답장 초안 모델 키 → 실제 모델 ID 해석 (server-only).
// saju-model-registry.ts 패턴. claude 는 resolveClaudeModel() 로 최신 opus 자동 선택
// (haiku 금지 — 거절 발생원). gemini/codex 는 정적 env.
import "server-only";
import { env } from "@/shared/config/env";
import { resolveClaudeModel } from "./resolve-claude-model";

// FSD: shared 는 entities 를 import 할 수 없어 ReplyModelKey 를 인라인 유니온으로 미러.
// entities/email-settings/model/replyModel.ts 의 REPLY_MODEL_KEYS 와 구조적으로 동일.
// (precedent: a3e8ee9 ReplyLanguage 인라인 유니온 — boundaries/element-types 위반 제거)
type ReplyModelKey = "gemini" | "codex" | "claude";

export async function resolveReplyModelId(key: ReplyModelKey): Promise<string> {
  switch (key) {
    case "gemini":
      return env.REPLY_LLM_MODEL_GEMINI;
    case "codex":
      return env.REPLY_LLM_MODEL_CODEX;
    case "claude":
      return resolveClaudeModel();
  }
}
