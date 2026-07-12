import { describe, it, expect } from "vitest";
import { tokenizeSearchQuery, escapeLike, SEARCH_MAX_TOKENS } from "./search";

describe("tokenizeSearchQuery", () => {
  it("공백으로 분리하고 빈 토큰을 버린다", () => {
    expect(tokenizeSearchQuery("  LG   위약금 ")).toEqual(["LG", "위약금"]);
  });

  it("중복 토큰을 제거한다", () => {
    expect(tokenizeSearchQuery("메모 메모 검색")).toEqual(["메모", "검색"]);
  });

  it("토큰 수를 상한으로 자른다", () => {
    const q = Array.from({ length: 12 }, (_, i) => `t${i}`).join(" ");
    expect(tokenizeSearchQuery(q)).toHaveLength(SEARCH_MAX_TOKENS);
  });

  it("100자 초과분을 잘라낸다", () => {
    const q = "a".repeat(150);
    expect(tokenizeSearchQuery(q)).toEqual(["a".repeat(100)]);
  });

  it("빈/공백 쿼리는 빈 배열", () => {
    expect(tokenizeSearchQuery("")).toEqual([]);
    expect(tokenizeSearchQuery("   ")).toEqual([]);
  });
});

describe("escapeLike", () => {
  it("% _ \\ 를 백슬래시 이스케이프한다", () => {
    expect(escapeLike("100%_할인\\경로")).toBe("100\\%\\_할인\\\\경로");
  });

  it("메타문자 없는 문자열은 그대로", () => {
    expect(escapeLike("위약금")).toBe("위약금");
  });
});
