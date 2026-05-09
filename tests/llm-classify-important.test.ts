// LLM 분류+요약 호출의 응답 파싱·검증 단위 테스트.
// Anthropic SDK는 mock — 실제 호출 X.
import { describe, it, expect, vi, beforeEach } from "vitest";

// anthropic 모듈을 mock — import 전에 선언.
vi.mock("@/shared/lib/llm/anthropic", () => {
  const create = vi.fn();
  return {
    anthropic: { messages: { create } },
    HAIKU_MODEL: "claude-haiku-4-5",
  };
});

import { anthropic } from "@/shared/lib/llm/anthropic";
import { classifyImportantWithLlm } from "@/shared/lib/llm/classify-important";
import type { ImportantInput } from "@/entities/email/model/types";

const baseInput: ImportantInput = {
  subject: "결제 완료",
  fromName: "Naver Pay",
  fromEmail: "noreply@pay.naver.com",
  snippet: "5/9 14:29 스타벅스 강남R점에서 27,500원 결제 완료",
  receivedAtKst: "2026-05-09 14:30 KST",
};

function mockLlmJson(obj: unknown): void {
  (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(obj) }],
  });
}

function mockLlmRaw(text: string): void {
  (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    content: [{ type: "text", text }],
  });
}

function mockLlmThrow(err: unknown): void {
  (anthropic.messages.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
}

describe("classifyImportantWithLlm", () => {
  beforeEach(() => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockReset();
  });

  it("정상 JSON → 파싱 성공", async () => {
    mockLlmJson({
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
    mockLlmJson({
      category: "none",
      importance: "med",
      summary: "마케팅",
      rationale: "",
    });
    expect(await classifyImportantWithLlm(baseInput)).toBeNull();
  });

  it("JSON parse 실패 → null (throw 안 함)", async () => {
    mockLlmRaw("이 메일은 중요해 보입니다.");
    expect(await classifyImportantWithLlm(baseInput)).toBeNull();
  });

  it("Zod 위반 (summary 250자) → null", async () => {
    mockLlmJson({
      category: "money",
      importance: "high",
      summary: "x".repeat(250),
      rationale: "...",
    });
    expect(await classifyImportantWithLlm(baseInput)).toBeNull();
  });

  it("Zod 위반 (category=evil) → null", async () => {
    mockLlmJson({
      category: "evil",
      importance: "high",
      summary: "...",
      rationale: "...",
    });
    expect(await classifyImportantWithLlm(baseInput)).toBeNull();
  });

  it("Zod 위반 (importance=low) → null (v0.1은 high/med만)", async () => {
    mockLlmJson({
      category: "money",
      importance: "low",
      summary: "...",
      rationale: "...",
    });
    expect(await classifyImportantWithLlm(baseInput)).toBeNull();
  });

  it("Anthropic 5xx → throw (재시도 후행)", async () => {
    mockLlmThrow(Object.assign(new Error("503"), { status: 503 }));
    await expect(classifyImportantWithLlm(baseInput)).rejects.toThrow();
  });

  it("Anthropic 4xx (rate limit) → throw", async () => {
    mockLlmThrow(Object.assign(new Error("429"), { status: 429 }));
    await expect(classifyImportantWithLlm(baseInput)).rejects.toThrow();
  });

  it("응답 content 비어있음 → null", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [],
    });
    expect(await classifyImportantWithLlm(baseInput)).toBeNull();
  });

  it("schema 통과 — 모든 카테고리", async () => {
    for (const cat of ["money", "security", "schedule", "notice"]) {
      mockLlmJson({
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
