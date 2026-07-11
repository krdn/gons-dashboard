import type {
  LlmProviderKey,
  LlmRecommendationRule,
} from "@/shared/lib/llm/provider-model-catalog";

// 프록시 /v1/models 목록은 수시로 바뀌므로 ID 하드코딩 대신 family 패턴으로 매칭한다.
// 규칙 순서 = 추천 우선순위. 매칭 알고리즘은 shared deriveModelOptions가 소유하고,
// 메모는 도메인 추천 이유(문구)만 이 표로 소유한다.
export const MEMO_MODEL_RECOMMENDATION_RULES: Record<
  LlmProviderKey,
  readonly LlmRecommendationRule[]
> = {
  claude: [
    {
      matches: (id) => id.includes("sonnet"),
      reason: "품질·속도 균형 — 기본 추천",
    },
    {
      matches: (id) => id.includes("haiku"),
      reason: "가장 빠르고 경제적",
    },
    {
      matches: (id) => id.includes("opus"),
      reason: "최고 품질 — 길고 복잡한 메모",
    },
  ],
  codex: [
    {
      // image 모델은 텍스트 정리에 부적합 — 프록시 목록에 섞여 있어 명시 제외
      matches: (id) =>
        id.startsWith("gpt-") &&
        !id.includes("oss") &&
        !id.includes("codex") &&
        !id.includes("image"),
      reason: "범용 고품질 — 기본 추천",
    },
    {
      matches: (id) => id.includes("oss"),
      reason: "경량 — 빠른 일상 정리",
    },
    {
      matches: (id) => id.includes("codex"),
      reason: "구조화·목록 정리 특화",
    },
  ],
  gemini: [
    {
      matches: (id) => id.includes("pro"),
      reason: "긴 문맥·자연스러운 문장 — 기본 추천",
    },
    {
      matches: (id) => id.includes("flash"),
      reason: "가장 빠르고 경제적",
    },
  ],
};
