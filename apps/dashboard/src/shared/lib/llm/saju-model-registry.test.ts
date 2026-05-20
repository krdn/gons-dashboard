import { describe, expect, it } from "vitest";
import {
  SAJU_MODEL_KEYS,
  SAJU_MODEL_REGISTRY,
  DEFAULT_SAJU_MODEL_KEY,
  parseSajuModelKey,
} from "./saju-model-registry";

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
