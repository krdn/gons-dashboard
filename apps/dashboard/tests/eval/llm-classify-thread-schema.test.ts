// LlmResponseSchema 직접 단위 테스트 — 영어 reason 길이 회귀 가드.
// 버그의 단위는 classifyWithLLM이 아니라 스키마 자체. 게이트웨이가 내부에서
// 앱이 넘긴 이 스키마로 검증하므로(@krdn/llm-gateway runner: tryParseAndValidate),
// 스키마를 직접 safeParse하는 게 가장 정확한 회귀 가드. mock·DB·LLM 의존 없음.
import { describe, it, expect } from "vitest";
import { LlmResponseSchema } from "@/shared/lib/llm/classify-thread";

describe("LlmResponseSchema reason 길이", () => {
  it("60자 영어 reason을 수용한다 (영어 메일 fallback FP 방지)", () => {
    const reason = "Sender explicitly asks for a decision on the Q3 budget plan";
    expect(reason.length).toBeGreaterThan(40); // 40자 초과임을 명시 (~60자)
    expect(reason.length).toBeLessThanOrEqual(80);
    const result = LlmResponseSchema.safeParse({
      needs_reply: true,
      severity: "high",
      reason,
    });
    expect(result.success).toBe(true);
  });

  it("81자 reason은 거부한다 (한도 상한 고정)", () => {
    const reason = "x".repeat(81);
    const result = LlmResponseSchema.safeParse({
      needs_reply: false,
      severity: "low",
      reason,
    });
    expect(result.success).toBe(false);
  });
});
