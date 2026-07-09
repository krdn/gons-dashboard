import { describe, it, expect } from "vitest";
import { deriveTitle } from "./types";

describe("deriveTitle", () => {
  it("첫 문장을 제목으로 파생한다", () => {
    expect(deriveTitle("내일 회의가 있다. 자료 준비 필요.")).toBe("내일 회의가 있다");
  });
  it("긴 첫 문장은 최대 길이로 자른다", () => {
    const long = "가".repeat(100);
    expect(deriveTitle(long).length).toBeLessThanOrEqual(50);
  });
  it("빈 문자열이면 기본 제목을 반환한다", () => {
    expect(deriveTitle("")).toBe("(제목 없음)");
    expect(deriveTitle("   ")).toBe("(제목 없음)");
  });
  it("마침표가 없으면 전체(길이 컷)에서 파생한다", () => {
    expect(deriveTitle("마침표 없는 짧은 메모")).toBe("마침표 없는 짧은 메모");
  });
});
