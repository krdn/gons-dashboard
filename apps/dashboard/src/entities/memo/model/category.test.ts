import { describe, it, expect } from "vitest";
import {
  SEED_MEMO_CATEGORIES,
  SEED_CATEGORY_LABELS,
  CATEGORY_SLUG_RE,
  isValidCategorySlug,
} from "./category";

describe("SEED_MEMO_CATEGORIES", () => {
  it("6종 시드를 slug+labelKo로 정의한다", () => {
    expect(SEED_MEMO_CATEGORIES).toHaveLength(6);
    expect(SEED_MEMO_CATEGORIES.map((c) => c.id)).toEqual([
      "idea",
      "todo",
      "journal",
      "reference",
      "draft",
      "etc",
    ]);
  });

  it("SEED_CATEGORY_LABELS가 slug→한글 라벨을 매핑한다", () => {
    expect(SEED_CATEGORY_LABELS.idea).toBe("아이디어");
    expect(SEED_CATEGORY_LABELS.etc).toBe("기타");
  });
});

describe("isValidCategorySlug", () => {
  it("kebab-case 영문 slug를 허용한다", () => {
    expect(isValidCategorySlug("idea")).toBe(true);
    expect(isValidCategorySlug("meeting-log")).toBe(true);
    expect(isValidCategorySlug("plan2")).toBe(true);
  });

  it("대문자·공백·한글·빈 문자열·첫 숫자를 거부한다", () => {
    expect(isValidCategorySlug("Idea")).toBe(false);
    expect(isValidCategorySlug("meeting log")).toBe(false);
    expect(isValidCategorySlug("회의록")).toBe(false);
    expect(isValidCategorySlug("")).toBe(false);
    expect(isValidCategorySlug("2plan")).toBe(false);
    expect(isValidCategorySlug(123)).toBe(false);
  });

  it("40자 초과를 거부한다", () => {
    expect(isValidCategorySlug("a".repeat(41))).toBe(false);
    expect(isValidCategorySlug("a".repeat(40))).toBe(true);
  });

  it("CATEGORY_SLUG_RE는 DB CHECK 패턴과 동치다", () => {
    expect(CATEGORY_SLUG_RE.test("meeting-log")).toBe(true);
    expect(CATEGORY_SLUG_RE.test("-lead")).toBe(false);
  });
});
