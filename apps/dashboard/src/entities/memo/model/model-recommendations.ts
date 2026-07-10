import type { MemoModelCatalog, MemoModelKey } from "./types";

export interface MemoModelRecommendation {
  modelId: string;
  reason: string;
}

interface RecommendationRule {
  /** 소문자 모델 ID가 이 family에 속하는지 판정 */
  matches: (lowerId: string) => boolean;
  reason: string;
}

// 프록시 /v1/models 목록은 수시로 바뀌므로 ID 하드코딩 대신 family 패턴으로 매칭한다.
// 규칙 순서 = 추천 우선순위. 카탈로그는 env 기본이 맨 앞 + 최신 우선 정렬이라
// find 한 번으로 family의 env 기본(있으면) 또는 최신 모델이 잡힌다.
const RECOMMENDATION_RULES: Record<MemoModelKey, RecommendationRule[]> = {
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

/**
 * 현재 카탈로그에 실제 존재하는 모델만 추천한다 (없는 모델 추천 → 저장 시
 * model-unavailable 함정 방지). 같은 모델이 두 규칙에 걸리면 먼저 온 규칙이 가진다.
 */
export function recommendMemoModels(
  catalog: MemoModelCatalog,
  provider: MemoModelKey,
): MemoModelRecommendation[] {
  const ids = catalog[provider];
  const taken = new Set<string>();
  const recommendations: MemoModelRecommendation[] = [];
  for (const rule of RECOMMENDATION_RULES[provider]) {
    const match = ids.find(
      (id) => !taken.has(id) && rule.matches(id.toLowerCase()),
    );
    if (match) {
      taken.add(match);
      recommendations.push({ modelId: match, reason: rule.reason });
    }
  }
  return recommendations;
}
