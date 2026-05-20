import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORTUNE_TAB,
  FORTUNE_TAB_KEYS,
  parseFortuneTabKey,
} from "./tab-key";

describe("parseFortuneTabKey", () => {
  it("returns DEFAULT_FORTUNE_TAB when input is undefined", () => {
    expect(parseFortuneTabKey(undefined)).toBe(DEFAULT_FORTUNE_TAB);
  });

  it("returns DEFAULT_FORTUNE_TAB when input is unknown string", () => {
    expect(parseFortuneTabKey("invalid")).toBe(DEFAULT_FORTUNE_TAB);
    expect(parseFortuneTabKey("")).toBe(DEFAULT_FORTUNE_TAB);
  });

  it("returns DEFAULT_FORTUNE_TAB when array first element is unknown", () => {
    expect(parseFortuneTabKey(["bogus", "lifetime"])).toBe(DEFAULT_FORTUNE_TAB);
  });

  it("uses the first array element when valid", () => {
    expect(parseFortuneTabKey(["yearly", "monthly"])).toBe("yearly");
  });

  it("accepts every valid FORTUNE_TAB_KEYS entry", () => {
    for (const key of FORTUNE_TAB_KEYS) {
      expect(parseFortuneTabKey(key)).toBe(key);
    }
  });

  it("returns DEFAULT_FORTUNE_TAB when input is empty array", () => {
    expect(parseFortuneTabKey([])).toBe(DEFAULT_FORTUNE_TAB);
  });
});
