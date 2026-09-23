import { describe, it, expect } from "vitest";
import { pickLatestModel, type ModelTier } from "./pick-latest-model";

describe("pickLatestModel — 프록시 관리 별칭만 선택", () => {
  it.each([
    [
      "opus",
      "claude-opus-latest",
      ["claude-opus-5", "claude-opus-5-5", "claude-opus-4-20250514"],
    ],
    ["gpt", "gpt-latest", ["gpt-5.5", "gpt-9.9", "gpt-5.6-sol"]],
    ["gemini-pro", "gemini-pro-latest", ["gemini-2.5-pro", "gemini-9.9-pro"]],
  ] satisfies [ModelTier, string, string[]][])(
    "%s는 숫자가 큰 후보보다 %s를 선택",
    (tier, alias, candidates) => {
      expect(pickLatestModel([...candidates, alias], tier)).toBe(alias);
      expect(pickLatestModel(candidates, tier)).toBeNull();
    },
  );

  it("단일 major Opus도 별칭을 통해 선택한다", () => {
    expect(
      pickLatestModel(["claude-opus-5", "claude-opus-latest"], "opus"),
    ).toBe("claude-opus-latest");
  });

  it("빈 목록 또는 다른 tier 별칭은 null — resolver가 env 고정값을 사용", () => {
    expect(pickLatestModel([], "opus")).toBeNull();
    expect(pickLatestModel(["gpt-latest"], "opus")).toBeNull();
  });
});
