import { describe, it, expect } from "vitest";
import { CleanupResponseSchema, isDegenerateCleanup } from "./cleanup-transcript";

describe("CleanupResponseSchema", () => {
  it("정상 cleaned 문자열을 통과시킨다", () => {
    expect(CleanupResponseSchema.safeParse({ cleaned: "정리된 텍스트" }).success).toBe(true);
  });
  it("빈 cleaned는 거부한다", () => {
    expect(CleanupResponseSchema.safeParse({ cleaned: "" }).success).toBe(false);
  });
});

describe("isDegenerateCleanup — 과도 축약 감지", () => {
  it("60% 미만으로 줄면 degenerate", () => {
    const raw = "가".repeat(100);
    expect(isDegenerateCleanup(raw, "가".repeat(50))).toBe(true);
  });
  it("정상 정리(경미한 축소)는 통과", () => {
    const raw = "어 그 내일 회의가 있어요";
    expect(isDegenerateCleanup(raw, "내일 회의가 있어요")).toBe(false);
  });
  it("빈 결과는 degenerate", () => {
    expect(isDegenerateCleanup("원문 있음", "")).toBe(true);
  });
});
