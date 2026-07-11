// 답장 초안 생성 모델 선택 메타 — client/server 양쪽 import 안전 (순수).
// env 접근 / 실제 모델 ID 해석은 shared/lib/llm/reply-model-registry.ts (server-only).
// 정책 (spec 2026-06-16): haiku 티어는 이메일 작성 거절 → 레지스트리에서 제외.
//   gemini(추천)·codex·claude(=opus) 만 허용. 경험적 검증 완료.
import type {
  LlmProviderKey,
  LlmRecommendationRule,
  ProviderModelCatalogSnapshot,
} from "@/shared/lib/llm/provider-model-catalog";

// 표시 순서는 답장 도메인이 소유한다 (gemini 추천 우선) — 공통 LLM_PROVIDER_KEYS
// 선언 순서와 무관.
export const REPLY_MODEL_KEYS = ["gemini", "codex", "claude"] as const;
export type ReplyModelKey = LlmProviderKey;

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

// 상세 모델 추천 규칙 (memo model-recommendations 패턴 — 규칙 순서 = 추천 우선순위).
// 프록시 /v1/models 목록은 수시로 바뀌므로 ID 하드코딩 대신 family 패턴으로 매칭.
export const REPLY_MODEL_RECOMMENDATION_RULES: Record<
  ReplyModelKey,
  LlmRecommendationRule[]
> = {
  gemini: [
    {
      matches: (id) => id.includes("pro"),
      reason: "자연스러운 답장, 저비용·고속 — 기본 추천",
    },
    {
      matches: (id) => id.includes("flash"),
      reason: "가장 빠르고 경제적",
    },
  ],
  codex: [
    {
      // image 모델은 답장 초안에 부적합 — 프록시 목록에 섞여 있어 명시 제외
      matches: (id) =>
        id.startsWith("gpt-") &&
        !id.includes("oss") &&
        !id.includes("codex") &&
        !id.includes("image"),
      reason: "범용 고품질 — 기본 추천",
    },
    {
      matches: (id) => id.includes("codex"),
      reason: "간결하고 구조적인 답장",
    },
  ],
  claude: [
    // haiku 규칙 없음 — haiku 티어는 이메일 작성 거절(파일 상단 정책 주석 참조)
    {
      matches: (id) => id.includes("opus"),
      reason: "최고 품질 — 중요한 답장",
    },
    {
      matches: (id) => id.includes("sonnet"),
      reason: "품질·속도 균형",
    },
  ],
};

// 설정 다이얼로그가 lazy 로드하는 카탈로그 응답 형태 (replyModelCatalogAction).
// "use server" 파일에서 타입을 정의/재-export하지 않는다 — dev 모듈 사망 전례
// (use-server-type-reexport-referenceerror) 회피를 위해 순수 모듈인 여기에 둔다.
export interface ReplyModelCatalogData {
  snapshot: ProviderModelCatalogSnapshot;
  // 각 키의 서버 기본 모델 ID (resolveReplyModelId 결과) — replyModelId=null 표시용.
  defaults: Record<ReplyModelKey, string>;
}

export const DEFAULT_REPLY_MODEL_KEY: ReplyModelKey = "gemini";

// raw 값을 안전하게 ReplyModelKey 로 정규화. Never throws.
export function parseReplyModelKey(raw: unknown): ReplyModelKey {
  if (typeof raw !== "string") return DEFAULT_REPLY_MODEL_KEY;
  return (REPLY_MODEL_KEYS as readonly string[]).includes(raw)
    ? (raw as ReplyModelKey)
    : DEFAULT_REPLY_MODEL_KEY;
}
