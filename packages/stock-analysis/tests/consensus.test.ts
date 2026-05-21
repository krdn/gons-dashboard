import { describe, it, expect } from "vitest";
import {
  tallyVerdicts,
  buildConsensusPrompt,
  type PersonaAnalysis,
  type PersonaKey,
  type Verdict,
} from "../src";

function persona(p: PersonaKey, v: Verdict): PersonaAnalysis {
  return {
    persona: p,
    verdict: v,
    oneLineThesis: "테스트용 한 줄 결론입니다 (20자 이상)",
    narrative: "x".repeat(400),
    keyMetrics: {},
    risks: ["테스트 리스크"],
    modelUsed: "claude",
  };
}

describe("tallyVerdicts", () => {
  it("5명 모두 BUY → 5/5 BUY", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "BUY"),
      persona("growth", "BUY"),
      persona("technical", "BUY"),
    ]);
    expect(r.majority).toBe("BUY");
    expect(r.score).toBe("5/5");
    expect(r.counts.BUY).toBe(5);
  });

  it("4 BUY + 1 SELL → 4/5 BUY", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "BUY"),
      persona("growth", "BUY"),
      persona("technical", "SELL"),
    ]);
    expect(r.majority).toBe("BUY");
    expect(r.score).toBe("4/5");
  });

  it("BUY 2 / SELL 2 / HOLD 1 동률 → HOLD 우선 (안전)", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "SELL"),
      persona("growth", "SELL"),
      persona("technical", "HOLD"),
    ]);
    expect(r.majority).toBe("HOLD");
  });

  it("3명만 성공 (2명 abstain): 2 BUY + 1 SELL → 2/5 BUY (denominator 5)", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "SELL"),
    ]);
    expect(r.majority).toBe("BUY");
    expect(r.score).toBe("2/5");
  });
});

describe("buildConsensusPrompt", () => {
  it("system + user 가 비어있지 않고 페르소나 결과를 인용", () => {
    const results = [
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "HOLD"),
    ];
    const prompt = buildConsensusPrompt(results, "claude");
    expect(prompt.system).toContain("투자 위원회");
    expect(prompt.user).toContain("wallStreet");
    expect(prompt.user).toContain("krExpert");
    expect(prompt.user).toContain("value");
  });

  it("modelUsed 가 user prompt 에 인용됨", () => {
    const results = [
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "HOLD"),
    ];
    const prompt = buildConsensusPrompt(results, "gemini");
    expect(prompt.user).toContain("gemini");
  });
});
