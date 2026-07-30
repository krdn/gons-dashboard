import { describe, expect, it } from "vitest";
import {
  SAJU_MODEL_KEYS,
  SAJU_MODEL_REGISTRY,
  DEFAULT_SAJU_MODEL_KEY,
  parseSajuModelKey,
} from "./saju-model-registry";
import { getModelDisplayLabel } from "./saju-model-registry-meta";

describe("SAJU_MODEL_KEYS", () => {
  it("contains exactly claude, codex, gemini", () => {
    expect(SAJU_MODEL_KEYS).toEqual(["claude", "codex", "gemini"]);
  });
});

describe("SAJU_MODEL_REGISTRY", () => {
  it("has all three keys with non-empty id and label", () => {
    for (const key of SAJU_MODEL_KEYS) {
      const info = SAJU_MODEL_REGISTRY[key];
      expect(info.id).toBeTruthy();
      expect(info.label).toBeTruthy();
      expect(info.vendor).toBeTruthy();
    }
  });
});

describe("DEFAULT_SAJU_MODEL_KEY", () => {
  it("is 'claude'", () => {
    expect(DEFAULT_SAJU_MODEL_KEY).toBe("claude");
  });
});

describe("parseSajuModelKey", () => {
  it.each(["claude", "codex", "gemini"] as const)(
    "returns same key for valid input %s",
    (input) => {
      expect(parseSajuModelKey(input)).toBe(input);
    },
  );

  it.each([undefined, null, "", "invalid", "CLAUDE", "openai", {}, [], 42, true])(
    "returns DEFAULT_SAJU_MODEL_KEY for invalid input %p",
    (input) => {
      expect(parseSajuModelKey(input)).toBe(DEFAULT_SAJU_MODEL_KEY);
    },
  );
});

describe("getModelDisplayLabel", () => {
  it.each([
    ["claude-opus-4-7", "Claude"],
    ["claude-haiku-4-5-20251001", "Claude"],
    ["gpt-5-codex", "Codex"],
    ["gpt-5", "Codex"],
    ["codex-latest", "Codex"],
    ["gemini-2.5-pro", "Gemini"],
    ["gemini-flash-2.0", "Gemini"],
    // 라벨과 라우팅이 갈리지 않아야 한다 — 이 ID 는 공급사 도출(접두사)로 gemini 라
    // 호출도 gemini 로 가는데, codex 의 부분 문자열 판정이 앞에 오면 Codex 로 표시됐다.
    ["gemini-codex-x", "Gemini"],
    ["claude-codex-1", "Claude"],
  ])("maps %s → %s", (modelId, label) => {
    expect(getModelDisplayLabel(modelId)).toBe(label);
  });

  it("falls back to raw modelId for unknown vendor", () => {
    expect(getModelDisplayLabel("mystery-model-9000")).toBe("mystery-model-9000");
  });
});
