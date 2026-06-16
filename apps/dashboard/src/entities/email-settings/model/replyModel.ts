// 답장 초안 생성 모델 선택 메타 — client/server 양쪽 import 안전 (순수).
// env 접근 / 실제 모델 ID 해석은 shared/lib/llm/reply-model-registry.ts (server-only).
// 정책 (spec 2026-06-16): haiku 티어는 이메일 작성 거절 → 레지스트리에서 제외.
//   gemini(추천)·codex·claude(=opus) 만 허용. 경험적 검증 완료.

export const REPLY_MODEL_KEYS = ["gemini", "codex", "claude"] as const;
export type ReplyModelKey = (typeof REPLY_MODEL_KEYS)[number];

export interface ReplyModelMeta {
  label: string;
  vendor: string;
  recommended: boolean;
  description: string;
}

export const REPLY_MODEL_META: Record<ReplyModelKey, ReplyModelMeta> = {
  gemini: {
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    recommended: true,
    description: "자연스러운 답장, 저비용·고속 — 권장",
  },
  codex: {
    label: "Codex (GPT-5)",
    vendor: "OpenAI",
    recommended: false,
    description: "대안 모델. 간결한 톤",
  },
  claude: {
    label: "Claude Opus 4.8",
    vendor: "Anthropic",
    recommended: false,
    description: "고품질이나 비용이 높음",
  },
};

export const DEFAULT_REPLY_MODEL_KEY: ReplyModelKey = "gemini";

// raw 값을 안전하게 ReplyModelKey 로 정규화. Never throws.
export function parseReplyModelKey(raw: unknown): ReplyModelKey {
  if (typeof raw !== "string") return DEFAULT_REPLY_MODEL_KEY;
  return (REPLY_MODEL_KEYS as readonly string[]).includes(raw)
    ? (raw as ReplyModelKey)
    : DEFAULT_REPLY_MODEL_KEY;
}
