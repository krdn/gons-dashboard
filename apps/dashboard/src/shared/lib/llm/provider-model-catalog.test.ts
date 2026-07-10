import { describe, it, expect } from "vitest";
import {
  isLlmModelIdForProvider,
  recommendLlmModels,
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

describe("recommendLlmModels", () => {
  const rules: Record<LlmProviderKey, LlmRecommendationRule[]> = {
    claude: [
      { matches: (id) => id.includes("opus"), reason: "첫째" },
      { matches: (id) => id.includes("sonnet"), reason: "둘째" },
    ],
    codex: [],
    gemini: [],
  };

  it("규칙 순서대로, 카탈로그에 존재하는 모델만 추천한다", () => {
    const catalog = catalogWith({
      claude: ["claude-sonnet-5", "claude-opus-4-8"],
    });
    const result = recommendLlmModels(catalog, "claude", rules);
    expect(result).toEqual([
      { modelId: "claude-opus-4-8", reason: "첫째" },
      { modelId: "claude-sonnet-5", reason: "둘째" },
    ]);
  });

  it("규칙이 없는 공급사는 빈 배열", () => {
    const catalog = catalogWith({ codex: ["gpt-5.5"] });
    expect(recommendLlmModels(catalog, "codex", rules)).toEqual([]);
  });
});

describe("SAJU_MODEL_RECOMMENDATION_RULES (사주 narrative 도메인 규칙)", () => {
  it("claude: opus가 기본 추천, sonnet이 뒤따른다", () => {
    const catalog = catalogWith({
      claude: ["claude-sonnet-5", "claude-opus-4-8"],
    });
    const result = recommendLlmModels(
      catalog,
      "claude",
      SAJU_MODEL_RECOMMENDATION_RULES,
    );
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
    const result = recommendLlmModels(
      catalog,
      "codex",
      SAJU_MODEL_RECOMMENDATION_RULES,
    );
    expect(result.map((r) => r.modelId)).toEqual(["gpt-5.5", "gpt-5.3-codex"]);
  });
});
