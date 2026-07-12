import { describe, expect, test } from "vitest";
import {
  MEMO_CATEGORY_IDS,
  MEMO_CATEGORY_LABELS,
  isMemoCategory,
} from "./category";

describe("MEMO_CATEGORY_LABELS", () => {
  test("모든 카테고리 slug에 라벨이 1:1로 존재한다", () => {
    expect(Object.keys(MEMO_CATEGORY_LABELS).sort()).toEqual(
      [...MEMO_CATEGORY_IDS].sort(),
    );
    for (const id of MEMO_CATEGORY_IDS) {
      expect(MEMO_CATEGORY_LABELS[id].length).toBeGreaterThan(0);
    }
  });
});

describe("isMemoCategory", () => {
  test("유효한 slug를 통과시킨다", () => {
    for (const id of MEMO_CATEGORY_IDS) {
      expect(isMemoCategory(id)).toBe(true);
    }
  });

  test("무효 값을 거부한다", () => {
    expect(isMemoCategory("unknown")).toBe(false);
    expect(isMemoCategory("")).toBe(false);
    expect(isMemoCategory(null)).toBe(false);
    expect(isMemoCategory(undefined)).toBe(false);
    expect(isMemoCategory(3)).toBe(false);
  });
});
