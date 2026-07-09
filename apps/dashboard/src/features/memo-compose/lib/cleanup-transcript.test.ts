import { describe, it, expect, vi, beforeEach } from "vitest";

const analyzeMock = vi.fn();
vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: (...a: unknown[]) => analyzeMock(...a),
}));
vi.mock("@/shared/lib/llm/anthropic", () => ({
  gatewayDefaults: { provider: "claude-cli", baseUrl: "http://test", apiKey: "k" },
  logLlmSpend: vi.fn(),
}));
vi.mock("@/shared/lib/llm/draft-reply", () => ({
  isRefusalDraft: (t: string) => t.startsWith("죄송"),
}));

import { CleanupResponseSchema, isDegenerateCleanup, cleanupTranscript } from "./cleanup-transcript";

beforeEach(() => {
  analyzeMock.mockReset();
});

describe("CleanupResponseSchema", () => {
  it("정상 cleaned 문자열을 통과시킨다", () => {
    expect(CleanupResponseSchema.safeParse({ cleaned: "정리된 텍스트" }).success).toBe(true);
  });
  it("빈 cleaned는 거부한다", () => {
    expect(CleanupResponseSchema.safeParse({ cleaned: "" }).success).toBe(false);
  });
});

describe("cleanupTranscript — 입력 길이 가드", () => {
  it("4,000자 초과 입력은 LLM 호출 없이 too-long 폴백 (절단 유실 방지)", async () => {
    const r = await cleanupTranscript("가".repeat(4_001));
    expect(r).toEqual({ kind: "raw-fallback", reason: "too-long" });
    expect(analyzeMock).not.toHaveBeenCalled();
  });
  it("빈 입력은 empty-input 폴백", async () => {
    expect(await cleanupTranscript("   ")).toEqual({ kind: "raw-fallback", reason: "empty-input" });
    expect(analyzeMock).not.toHaveBeenCalled();
  });
  it("4,000자 이하는 전체 입력으로 정상 호출", async () => {
    analyzeMock.mockResolvedValue({ object: { cleaned: "가".repeat(3_000) }, usage: {} });
    const input = "가".repeat(3_000);
    const r = await cleanupTranscript(input);
    expect(r.kind).toBe("ok");
    expect(analyzeMock).toHaveBeenCalledWith(input, expect.anything(), expect.anything());
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
