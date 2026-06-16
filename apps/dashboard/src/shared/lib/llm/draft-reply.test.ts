import { describe, it, expect, vi } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
}));

import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { draftReply, languageInstruction } from "./draft-reply";

const mockAnalyze = vi.mocked(analyzeStructured);

describe("languageInstruction", () => {
  it("auto는 원본 언어 지시", () => {
    expect(languageInstruction("auto")).toContain("같은 언어");
  });
  it("en은 English 지시", () => {
    expect(languageInstruction("en")).toContain("English");
  });
  it("ko는 한국어 지시", () => {
    expect(languageInstruction("ko")).toContain("한국어");
  });
  it("ja는 日本語 지시", () => {
    expect(languageInstruction("ja")).toContain("日本語");
  });
  it("zh는 中文 지시", () => {
    expect(languageInstruction("zh")).toContain("中文");
  });
});

describe("draftReply", () => {
  it("정상 → ok + body 반환", async () => {
    mockAnalyze.mockResolvedValueOnce({
      object: { body: "안녕하세요, 검토 후 회신드리겠습니다." },
    } as never);
    const result = await draftReply({
      fromEmail: "a@b.com",
      subject: "프로젝트 참여 가능 여부",
      bodyText: "참여 가능한지 알려주세요.",
      severity: "med",
      language: "auto",
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.body).toContain("회신");
  });

  it("LLM 에러 → llm-unavailable", async () => {
    mockAnalyze.mockRejectedValueOnce(new Error("gateway down"));
    const result = await draftReply({
      fromEmail: "a@b.com",
      subject: "x",
      bodyText: "y",
      severity: "low",
      language: "auto",
    });
    expect(result.kind).toBe("llm-unavailable");
  });
});
