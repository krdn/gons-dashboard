import { describe, it, expect } from "vitest";
import {
  REPLY_MODEL_KEYS,
  REPLY_MODEL_META,
  REPLY_MODEL_RECOMMENDATION_RULES,
  DEFAULT_REPLY_MODEL_KEY,
  parseReplyModelKey,
} from "./replyModel";
import {
  deriveModelOptions,
  type LlmProviderKey,
  type ProviderModelCatalog,
} from "@/shared/lib/llm/provider-model-catalog";

describe("replyModel registry", () => {
  it("기본값은 gemini (추천·검증된 모델)", () => {
    expect(DEFAULT_REPLY_MODEL_KEY).toBe("gemini");
  });

  it("gemini만 recommended=true", () => {
    expect(REPLY_MODEL_META.gemini.recommended).toBe(true);
    expect(REPLY_MODEL_META.codex.recommended).toBe(false);
    expect(REPLY_MODEL_META.claude.recommended).toBe(false);
  });

  it("claude 라벨은 Opus (haiku 아님 — 거절 발생원 제외)", () => {
    expect(REPLY_MODEL_META.claude.label).toContain("Opus");
  });

  it("3개 키 모두 메타 존재", () => {
    for (const k of REPLY_MODEL_KEYS) {
      expect(REPLY_MODEL_META[k].label).toBeTruthy();
      expect(REPLY_MODEL_META[k].vendor).toBeTruthy();
    }
  });

  it("parseReplyModelKey: 유효값 통과", () => {
    expect(parseReplyModelKey("codex")).toBe("codex");
  });

  it("parseReplyModelKey: 잘못된 값은 기본값 폴백", () => {
    expect(parseReplyModelKey("bogus")).toBe("gemini");
    expect(parseReplyModelKey(undefined)).toBe("gemini");
    expect(parseReplyModelKey(42)).toBe("gemini");
  });
});

describe("REPLY_MODEL_RECOMMENDATION_RULES (상세 모델 추천 규칙)", () => {
  const emptyCatalog = { claude: [], codex: [], gemini: [] };

  function recommendWith(catalog: ProviderModelCatalog, provider: LlmProviderKey) {
    return deriveModelOptions({
      snapshot: { catalog, source: "live" },
      selection: {
        provider,
        modelId: catalog[provider][0] ?? "gemini-2.5-pro",
      },
      recommendationRules: REPLY_MODEL_RECOMMENDATION_RULES,
    }).recommended;
  }

  it("claude: haiku는 어떤 규칙에도 안 걸린다 (이메일 작성 거절 정책)", () => {
    const catalog = { ...emptyCatalog, claude: ["claude-haiku-4-5-20251001"] };
    expect(recommendWith(catalog, "claude")).toEqual([]);
  });

  it("codex: image·oss·codex 계열은 범용 규칙에서 제외된다", () => {
    const catalog = {
      ...emptyCatalog,
      codex: ["gpt-image-1", "gpt-oss-120b-medium", "gpt-5.3-codex", "gpt-5.5"],
    };
    const result = recommendWith(catalog, "codex");
    expect(result.map((r) => r.modelId)).toEqual(["gpt-5.5", "gpt-5.3-codex"]);
  });

  it("gemini: pro가 기본 추천, flash가 뒤따른다", () => {
    const catalog = {
      ...emptyCatalog,
      gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
    };
    const result = recommendWith(catalog, "gemini");
    expect(result.map((r) => r.modelId)).toEqual([
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ]);
    expect(result[0].reason).toContain("기본 추천");
  });
});
