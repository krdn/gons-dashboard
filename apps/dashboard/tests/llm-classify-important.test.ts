// LLM 분류+요약 호출의 응답 파싱·검증 단위 테스트.
// llm-gateway 의 analyzeStructured 를 mock — 실제 호출 X.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
  normalizeUsage: vi.fn(),
}));

import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { classifyImportantWithLlm } from "@/shared/lib/llm/classify-important";
import type { ImportantInput } from "@/entities/email/model/types";

const mockAnalyze = analyzeStructured as ReturnType<typeof vi.fn>;

const baseInput: ImportantInput = {
  subject: "결제 완료",
  fromName: "Naver Pay",
  fromEmail: "noreply@pay.naver.com",
  snippet: "5/9 14:29 스타벅스 강남R점에서 27,500원 결제 완료",
  receivedAtKst: "2026-05-09 14:30 KST",
};

function mockGateway(obj: unknown): void {
  mockAnalyze.mockResolvedValueOnce({ object: obj, usage: {}, finishReason: "stop" });
}

function mockGatewayThrow(err: unknown): void {
  mockAnalyze.mockRejectedValueOnce(err);
}

describe("classifyImportantWithLlm", () => {
  beforeEach(() => {
    mockAnalyze.mockReset();
  });

  it("정상 JSON → 파싱 성공", async () => {
    mockGateway({
      category: "money",
      importance: "high",
      summary: "스타벅스 27,500원 결제",
      rationale: "발신자 naver-pay + '결제 완료' 패턴",
    });
    const result = await classifyImportantWithLlm(baseInput);
    expect(result?.category).toBe("money");
    expect(result?.importance).toBe("high");
    expect(result?.summary).toBe("스타벅스 27,500원 결제");
    expect(result?.classifiedBy).toBe("llm-haiku");
    expect(result?.classifierVersion).toBe("v1.0-haiku-important-2026-05");
  });

  it("category=none → null", async () => {
    mockGateway({
      category: "none",
      importance: "med",
      summary: "마케팅",
      rationale: "",
    });
    expect(await classifyImportantWithLlm(baseInput)).toBeNull();
  });

  it("gateway 에러 → throw (상위에서 catch)", async () => {
    mockGatewayThrow(new Error("503"));
    await expect(classifyImportantWithLlm(baseInput)).rejects.toThrow("503");
  });

  it("gateway rate limit → throw", async () => {
    mockGatewayThrow(Object.assign(new Error("429"), { status: 429 }));
    await expect(classifyImportantWithLlm(baseInput)).rejects.toThrow("429");
  });

  it("schema 통과 — 모든 카테고리", async () => {
    for (const cat of ["money", "security", "schedule", "notice"]) {
      mockGateway({
        category: cat,
        importance: "med",
        summary: "테스트",
        rationale: "테스트",
      });
      const result = await classifyImportantWithLlm(baseInput);
      expect(result?.category).toBe(cat);
    }
  });
});
