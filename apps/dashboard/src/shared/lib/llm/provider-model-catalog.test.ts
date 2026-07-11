import { describe, it, expect } from "vitest";
import {
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
    ["codex", "gemini-2.5-pro", false],
    ["gemini", "gemini-2.5-flash", true],
    ["gemini", "claude-sonnet-5", false],
  ] as const)("%s × %s → %s", (provider, id, expected) => {
    expect(isLlmModelIdForProvider(provider as LlmProviderKey, id)).toBe(
      expected,
    );
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
