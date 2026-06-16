import { describe, it, expect, vi } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
}));

import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import {
  draftReply,
  languageInstruction,
  isRefusalDraft,
} from "./draft-reply";

const mockAnalyze = vi.mocked(analyzeStructured);

describe("isRefusalDraft", () => {
  it("CLI 정체성 거절 문구 감지", () => {
    expect(
      isRefusalDraft(
        "I appreciate you reaching out, but I'm Claude Code, Anthropic's CLI tool",
      ),
    ).toBe(true);
    expect(isRefusalDraft("I'm not able to help with composing email")).toBe(
      true,
    );
  });
  it("정상 한국어 답장은 false", () => {
    expect(
      isRefusalDraft(
        "안녕하세요, 보내주신 메일 잘 받았습니다. 참여하고 싶습니다.",
      ),
    ).toBe(false);
  });
  it("일반어 '코딩'·'software engineering' 포함해도 정상이면 false (오탐 방지)", () => {
    expect(
      isRefusalDraft("코딩 교육 문의에 답변드립니다. 참여 가능합니다."),
    ).toBe(false);
  });
});

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
