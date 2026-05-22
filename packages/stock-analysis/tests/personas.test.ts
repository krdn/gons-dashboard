import { describe, it, expect } from "vitest";
import {
  PERSONA_BUILDERS,
  PersonaAnalysisSchema,
  type PersonaInput,
  type PersonaKey,
} from "../src";

const SAMPLE_INPUT: PersonaInput = {
  symbol: "AAPL",
  displayName: "Apple Inc.",
  assetClass: "stock",
  market: "NASDAQ",
  snapshot: {
    price: 180.5,
    changePct: 1.2,
    currency: "USD",
    marketCap: 3_000_000_000_000,
    per: 28.5,
    pbr: 42.1,
    dividendYield: 0.005,
    asOf: "2026-05-21T00:00:00Z",
  },
  dailyOHLC: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, "0")}`,
    close: 175 + i * 0.5,
    volume: 50_000_000,
  })),
};

describe("PERSONA_BUILDERS", () => {
  const PERSONAS: PersonaKey[] = [
    "wallStreet",
    "krExpert",
    "value",
    "growth",
    "technical",
  ];

  PERSONAS.forEach((persona) => {
    it(`${persona}: prompt 가 system + user 를 가지고 빈 문자열 아님`, () => {
      const prompt = PERSONA_BUILDERS[persona](SAMPLE_INPUT);
      expect(prompt.system).toBeTruthy();
      expect(prompt.user).toBeTruthy();
      expect(prompt.system.length).toBeGreaterThan(50);
      expect(prompt.user.length).toBeGreaterThan(50);
    });

    it(`${persona}: user prompt 에 symbol 명시`, () => {
      const prompt = PERSONA_BUILDERS[persona](SAMPLE_INPUT);
      expect(prompt.user).toContain("AAPL");
    });

    it(`${persona}: snapshot 의 수치가 prompt 에 인용됨`, () => {
      const prompt = PERSONA_BUILDERS[persona](SAMPLE_INPUT);
      // 정확한 price 또는 PER 또는 시총 중 하나는 반드시 인용
      const cited =
        prompt.user.includes("180.5") ||
        prompt.user.includes("28.5") ||
        prompt.user.includes("3000000000000") ||
        prompt.user.includes("3,000,000,000,000");
      expect(cited).toBe(true);
    });
  });
});

describe("PersonaAnalysisSchema", () => {
  it("정상 입력 통과", () => {
    const valid = {
      persona: "wallStreet" as const,
      verdict: "BUY" as const,
      oneLineThesis: "메모리 사이클 회복 + HBM 점유율 확대로 매수 권장",
      narrative: "x".repeat(400),
      keyMetrics: { targetPrice12M: 200 },
      risks: ["미·중 반도체 규제 리스크"],
      modelUsed: "claude" as const,
    };
    expect(() => PersonaAnalysisSchema.parse(valid)).not.toThrow();
  });

  it("narrative 가 너무 짧으면 fail", () => {
    const invalid = {
      persona: "wallStreet" as const,
      verdict: "BUY" as const,
      oneLineThesis: "메모리 사이클 회복 + HBM 점유율 확대로 매수 권장",
      narrative: "짧음",
      keyMetrics: {},
      risks: ["리스크"],
      modelUsed: "claude" as const,
    };
    expect(() => PersonaAnalysisSchema.parse(invalid)).toThrow();
  });

  it("keyMetrics 에 null 값 허용 (펀더멘털 누락 시 추정 불가 응답)", () => {
    const validWithNull = {
      persona: "value" as const,
      verdict: "HOLD" as const,
      oneLineThesis: "PER/PBR 데이터 부재로 정량 판단 추정 불가",
      narrative: "x".repeat(400),
      keyMetrics: {
        fairPER: null,
        marginOfSafety: "추정 불가",
        dcfTarget: null,
      },
      risks: ["가치 함정 가능성", "데이터 부재 리스크"],
      modelUsed: "codex" as const,
    };
    expect(() => PersonaAnalysisSchema.parse(validWithNull)).not.toThrow();
  });

  it("risks 가 0개면 fail (환각 가드)", () => {
    const invalid = {
      persona: "wallStreet" as const,
      verdict: "BUY" as const,
      oneLineThesis: "메모리 사이클 회복 + HBM 점유율 확대로 매수 권장",
      narrative: "x".repeat(400),
      keyMetrics: {},
      risks: [],
      modelUsed: "claude" as const,
    };
    expect(() => PersonaAnalysisSchema.parse(invalid)).toThrow();
  });
});
