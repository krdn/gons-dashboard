import { describe, it, expect, vi } from "vitest";

vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: vi.fn(),
}));

import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { draftReply } from "./draft-reply";

const mockAnalyze = vi.mocked(analyzeStructured);

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
    });
    expect(result.kind).toBe("llm-unavailable");
  });
});
