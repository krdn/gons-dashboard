import { describe, expect, test } from "vitest";
import { normalizePersonaOverride } from "./persona-model-override";

describe("normalizePersonaOverride", () => {
  test("legacy string value 를 override 객체로 변환한다", () => {
    expect(normalizePersonaOverride("claude")).toEqual({ model: "claude" });
    expect(normalizePersonaOverride("codex")).toEqual({ model: "codex" });
    expect(normalizePersonaOverride("gemini")).toEqual({ model: "gemini" });
  });

  test("객체 value 는 model + modelId 를 보존한다", () => {
    expect(
      normalizePersonaOverride({ model: "codex", modelId: "gpt-5.5" }),
    ).toEqual({ model: "codex", modelId: "gpt-5.5" });
  });

  test("modelId 가 없거나 빈 문자열이면 model 만 반환한다", () => {
    expect(normalizePersonaOverride({ model: "claude" })).toEqual({
      model: "claude",
    });
    expect(normalizePersonaOverride({ model: "claude", modelId: "" })).toEqual(
      { model: "claude" },
    );
  });

  test("알 수 없는 model / 잘못된 형태는 null 을 반환한다", () => {
    expect(normalizePersonaOverride("haiku")).toBeNull();
    expect(normalizePersonaOverride({ model: "haiku" })).toBeNull();
    expect(normalizePersonaOverride({ modelId: "gpt-5.5" })).toBeNull();
    expect(normalizePersonaOverride(null)).toBeNull();
    expect(normalizePersonaOverride(undefined)).toBeNull();
    expect(normalizePersonaOverride(42)).toBeNull();
  });
});
