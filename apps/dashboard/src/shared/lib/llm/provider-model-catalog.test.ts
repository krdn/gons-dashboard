import { describe, it, expect } from "vitest";
import {
  LLM_PROVIDER_KEYS,
  deriveLlmProviderFromModelId,
  deriveModelOptions,
  isLlmModelIdForProvider,
  sanitizeLlmModelId,
  type LlmRecommendationRule,
  type LlmProviderKey,
  type ProviderModelCatalog,
} from "./provider-model-catalog";
import { SAJU_MODEL_RECOMMENDATION_RULES } from "./saju-model-registry-meta";

function catalogWith(
  partial: Partial<ProviderModelCatalog>,
): ProviderModelCatalog {
  return { claude: [], codex: [], gemini: [], ...partial };
}

describe("isLlmModelIdForProvider", () => {
  it.each([
    ["claude", "claude-opus-4-8", true],
    ["claude", "gpt-5.3-codex", false],
    ["codex", "gpt-5.3-codex", true],
    ["codex", "gpt-oss-120b-medium", true],
    ["codex", "o3-mini", true],
    // codex 접두사 형태 — gpt- 로도 o<digit> 으로도 안 잡히는 유일한 실물 계열.
    // 이 행이 codex 접두사 분기의 존재 이유다 (지우면 카탈로그에서 조용히 빠진다).
    ["codex", "codex-auto-review", true],
    ["codex", "gemini-2.5-pro", false],
    ["gemini", "gemini-2.5-flash", true],
    ["gemini", "claude-sonnet-5", false],
    // 지원 밖 계열 (프록시가 노출하지만 대시보드는 안 다룬다) — 어느 쪽도 아니다.
    ["claude", "grok-4.3", false],
    ["codex", "grok-4.3", false],
    ["gemini", "grok-4.3", false],
  ] as const)("%s × %s → %s", (provider, id, expected) => {
    expect(isLlmModelIdForProvider(provider as LlmProviderKey, id)).toBe(
      expected,
    );
  });

  // 개별 행이 아니라 술어 집합의 성질을 고정한다 — 이 성질이 깨지면 공급사 도출이
  // LLM_PROVIDER_KEYS 선언 순서에 좌우된다 (사주 모델 선택 버그 3회 재발의 뿌리).
  it.each([
    "claude-opus-4-8",
    "gpt-5.5",
    "gpt-5.3-codex-spark",
    "o3-mini",
    "codex-auto-review",
    "gemini-pro-latest",
    "grok-4.3",
    // 옛 부분 문자열 판정의 반례 — 실물엔 없지만 배타성이 무너지면 즉시 재현된다.
    "gemini-codex-x",
    "claude-codex-1",
  ])("%s 는 최대 한 공급사에만 매칭된다", (id) => {
    const matched = LLM_PROVIDER_KEYS.filter((provider) =>
      isLlmModelIdForProvider(provider, id),
    );
    expect(matched.length).toBeLessThanOrEqual(1);
  });
});

describe("deriveLlmProviderFromModelId", () => {
  it.each([
    ["claude-opus-5", "claude"],
    ["gpt-5.5", "codex"],
    ["o3-mini", "codex"],
    ["codex-auto-review", "codex"],
    ["gemini-pro-latest", "gemini"],
    // 옛 부분 문자열 판정이 codex 로 훔쳐가던 형태 — 접두사가 공급사를 정한다.
    ["gemini-codex-x", "gemini"],
    ["claude-codex-1", "claude"],
  ] as const)("%s → %s", (id, expected) => {
    expect(deriveLlmProviderFromModelId(id)).toBe(expected);
  });

  it("지원하지 않는 계열은 null (프록시의 grok-*, 오타 등)", () => {
    expect(deriveLlmProviderFromModelId("grok-4.3")).toBeNull();
    expect(deriveLlmProviderFromModelId("gpt5.5")).toBeNull();
  });
});

describe("sanitizeLlmModelId", () => {
  it("정상 프록시 ID 형태는 trim 후 통과", () => {
    expect(sanitizeLlmModelId(" claude-opus-4-8 ")).toBe("claude-opus-4-8");
    expect(sanitizeLlmModelId("gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(sanitizeLlmModelId("gemini-2.5-pro-latest")).toBe(
      "gemini-2.5-pro-latest",
    );
  });

  it("비문자열·빈 값·이상 문자는 null", () => {
    expect(sanitizeLlmModelId(undefined)).toBeNull();
    expect(sanitizeLlmModelId(null)).toBeNull();
    expect(sanitizeLlmModelId("")).toBeNull();
    expect(sanitizeLlmModelId("model id with spaces")).toBeNull();
    expect(sanitizeLlmModelId("<script>alert(1)</script>")).toBeNull();
    expect(sanitizeLlmModelId("-leading-dash")).toBeNull();
  });

  it("100자 초과는 null", () => {
    expect(sanitizeLlmModelId(`m${"a".repeat(100)}`)).toBeNull();
  });
});

describe("deriveModelOptions", () => {
  const rules: Record<LlmProviderKey, readonly LlmRecommendationRule[]> = {
    claude: [
      { matches: (id) => id.includes("opus"), reason: "첫째" },
      { matches: (id) => id.includes("sonnet"), reason: "둘째" },
      { matches: (id) => id.includes("opus"), reason: "중복" },
    ],
    codex: [],
    gemini: [],
  };

  const catalog = catalogWith({
    claude: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
  });

  it("규칙 우선순위와 중복 제거를 적용하고 나머지를 other로 반환한다", () => {
    expect(
      deriveModelOptions({
        snapshot: { catalog, source: "live" },
        selection: { provider: "claude", modelId: "claude-opus-4-8" },
        recommendationRules: rules,
      }),
    ).toEqual({
      recommended: [
        { modelId: "claude-opus-4-8", reason: "첫째" },
        { modelId: "claude-sonnet-5", reason: "둘째" },
      ],
      other: ["claude-haiku-4-5"],
      availability: "available",
    });
  });

  it("live 목록에서 사라진 선택은 unavailable이다", () => {
    const result = deriveModelOptions({
      snapshot: { catalog, source: "live" },
      selection: { provider: "claude", modelId: "claude-opus-3" },
      recommendationRules: rules,
    });
    expect(result.availability).toBe("unavailable");
  });

  it("fallback snapshot은 목록 포함 여부와 무관하게 unknown이다", () => {
    const result = deriveModelOptions({
      snapshot: { catalog, source: "fallback" },
      selection: { provider: "claude", modelId: "claude-opus-3" },
      recommendationRules: rules,
    });
    expect(result.availability).toBe("unknown");
  });
});

describe("SAJU_MODEL_RECOMMENDATION_RULES (사주 narrative 도메인 규칙)", () => {
  it("claude: opus가 기본 추천, sonnet이 뒤따른다", () => {
    const catalog = catalogWith({
      claude: ["claude-sonnet-5", "claude-opus-4-8"],
    });
    const result = deriveModelOptions({
      snapshot: { catalog, source: "live" },
      selection: { provider: "claude", modelId: catalog.claude[0] },
      recommendationRules: SAJU_MODEL_RECOMMENDATION_RULES,
    }).recommended;
    expect(result.map((r) => r.modelId)).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-5",
    ]);
    expect(result[0].reason).toContain("기본 추천");
  });

  it("codex: image·oss는 범용 규칙에서 제외, codex 계열은 특화 규칙", () => {
    const catalog = catalogWith({
      codex: ["gpt-image-1", "gpt-oss-120b-medium", "gpt-5.3-codex", "gpt-5.5"],
    });
    const result = deriveModelOptions({
      snapshot: { catalog, source: "live" },
      selection: { provider: "codex", modelId: catalog.codex[0] },
      recommendationRules: SAJU_MODEL_RECOMMENDATION_RULES,
    }).recommended;
    expect(result.map((r) => r.modelId)).toEqual(["gpt-5.5", "gpt-5.3-codex"]);
  });
});
