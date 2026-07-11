import { describe, it, expect } from "vitest";
import { deriveModelOptions } from "@/shared/lib/llm/provider-model-catalog";
import { MEMO_MODEL_RECOMMENDATION_RULES } from "./model-recommendations";
import type { MemoModelCatalog, MemoModelKey } from "./types";

function catalogWith(partial: Partial<MemoModelCatalog>): MemoModelCatalog {
  return { claude: [], codex: [], gemini: [], ...partial };
}

function recommendWith(catalog: MemoModelCatalog, provider: MemoModelKey) {
  return deriveModelOptions({
    snapshot: { catalog, source: "live" },
    selection: {
      provider,
      modelId: catalog[provider][0] ?? "claude-sonnet-5",
    },
    recommendationRules: MEMO_MODEL_RECOMMENDATION_RULES,
  }).recommended;
}

describe("MEMO_MODEL_RECOMMENDATION_RULES", () => {
  it("claude family가 모두 있으면 우선순위 순(sonnet→haiku→opus)으로 추천한다", () => {
    const catalog = catalogWith({
      claude: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
    });

    const result = recommendWith(catalog, "claude");

    expect(result.map((r) => r.modelId)).toEqual([
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-8",
    ]);
    expect(result[0].reason).toContain("기본 추천");
  });

  it("카탈로그에 없는 family는 건너뛴다", () => {
    const catalog = catalogWith({
      claude: ["claude-sonnet-5", "claude-opus-4-8"],
    });

    const result = recommendWith(catalog, "claude");

    expect(result.map((r) => r.modelId)).toEqual([
      "claude-sonnet-5",
      "claude-opus-4-8",
    ]);
  });

  it("같은 family가 여럿이면 카탈로그 앞쪽(최신/env 기본)을 집는다", () => {
    const catalog = catalogWith({
      claude: ["claude-sonnet-5", "claude-sonnet-4-6"],
    });

    const result = recommendWith(catalog, "claude");

    expect(result.map((r) => r.modelId)).toEqual(["claude-sonnet-5"]);
  });

  it("codex: codex 계열은 범용 규칙에서 제외되고 특화 규칙이 가진다", () => {
    const catalog = catalogWith({
      codex: ["gpt-5.3-codex", "gpt-oss-120b-medium"],
    });

    const result = recommendWith(catalog, "codex");

    expect(result).toEqual([
      { modelId: "gpt-oss-120b-medium", reason: "경량 — 빠른 일상 정리" },
      { modelId: "gpt-5.3-codex", reason: "구조화·목록 정리 특화" },
    ]);
  });

  it("codex: image 모델은 범용 추천에서 제외된다", () => {
    const catalog = catalogWith({
      codex: ["gpt-image-2", "gpt-5.5"],
    });

    const result = recommendWith(catalog, "codex");

    expect(result.map((r) => r.modelId)).toEqual(["gpt-5.5"]);
  });

  it("한 모델이 두 규칙에 걸려도 먼저 온 규칙만 가진다 (중복 없음)", () => {
    const catalog = catalogWith({ gemini: ["gemini-pro-latest"] });

    const result = recommendWith(catalog, "gemini");

    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe("gemini-pro-latest");
  });

  it("빈 카탈로그면 빈 배열을 반환한다", () => {
    expect(recommendWith(catalogWith({}), "claude")).toEqual([]);
  });

  it("대문자 ID도 family 매칭된다", () => {
    const catalog = catalogWith({ claude: ["Claude-Sonnet-5"] });

    const result = recommendWith(catalog, "claude");

    expect(result.map((r) => r.modelId)).toEqual(["Claude-Sonnet-5"]);
  });
});
