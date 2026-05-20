// v0.3.1 monthly LLM 출력 zod 스키마 단위 테스트.
// yearly schemas.test.ts 패턴 미러링. 분량만 monthly 정책 (narrativeText 800~1500) 으로 조정.
import { describe, expect, it } from "vitest";
import { SCHOOL_SCHEMAS } from "./schemas";

const dummy150 = "가".repeat(150);
const dummy800 = "나".repeat(800);

function baseOk() {
  return {
    narrativeText: dummy800,
    sections: {
      personality: dummy150,
      career: dummy150,
      relationship: dummy150,
      health: dummy150,
      daeunSummary: dummy150,
      keyTerms: [
        { term: "月運", gloss: "월운 — 이번 달 한 달의 운" },
        { term: "應期", gloss: "응기 — 사건이 일어나는 시점" },
        { term: "傷官", gloss: "상관 — 식상의 한 종류" },
      ],
      cautions: ["관계 충돌 주의"],
    },
    citations: ["적천수·통신론", "자평진전·격국편"],
  };
}

describe("monthly SCHOOL_SCHEMAS — ko", () => {
  it("유효 ko 페이로드 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["이번 달 도화살 강화"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).not.toThrow();
  });

  it("joohuFocus 70자 미만 → throw", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: { joohuFocus: "짧음", shinsalNotes: ["x"] },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  it("cn-ziping schoolSpecific 을 ko 로 검증 → throw", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        gyeokgukRationale: "라".repeat(100),
        yongshinAnalysis: "마".repeat(100),
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });
});

describe("monthly SCHOOL_SCHEMAS — cn-ziping", () => {
  it("유효 ziping 페이로드 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        gyeokgukRationale: "라".repeat(100),
        yongshinAnalysis: "마".repeat(100),
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-ziping"].parse(payload)).not.toThrow();
  });
});

describe("monthly SCHOOL_SCHEMAS — cn-mangpai", () => {
  it("eventTimings 3건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: [
          { period: "상순", event: "재물 변동" },
          { period: "중순", event: "관계 갈등" },
          { period: "하순", event: "결정" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).not.toThrow();
  });

  it("eventTimings 6건 → throw (max 5)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: Array.from({ length: 6 }, (_, i) => ({
          period: String(i),
          event: "x",
        })),
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).toThrow();
  });
});

describe("monthly SCHOOL_SCHEMAS — jp", () => {
  it("palaceMap 3건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "命宮(명궁)", note: "이번 달 본질" },
          { palace: "財帛宮(재백궁)", note: "이번 달 재물" },
          { palace: "官祿宮(관록궁)", note: "이번 달 직장" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).not.toThrow();
  });

  it("palaceMap 2건 → throw (min 3)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "a", note: "1" },
          { palace: "b", note: "2" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).toThrow();
  });
});

describe("monthly SCHOOL_SCHEMAS — 공통 base 검증", () => {
  it("narrativeText 800자 미만 → throw", () => {
    const payload = {
      ...baseOk(),
      narrativeText: "짧음",
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["x"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  // Hotfix #2: min 약화로 boundary 갱신 — citations/keyTerms min 1.
  it("citations 0개 → throw (min 1)", () => {
    const payload = {
      ...baseOk(),
      citations: [],
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["x"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  // Hotfix #5: keyTerms 가 누락되거나 0개여도 통과 (Gemini variance 흡수).
  it("keyTerms 누락 → empty array 로 default", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: { joohuFocus: "다".repeat(70), shinsalNotes: ["x"] },
    };
    // @ts-expect-error — Hotfix #5 행동 검증: undefined 도 통과
    delete payload.sections.keyTerms;
    const result = SCHOOL_SCHEMAS.ko.parse(payload);
    expect(result.sections.keyTerms).toEqual([]);
  });

  it("keyTerms 0개 → 통과 (Hotfix #5)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: { joohuFocus: "다".repeat(70), shinsalNotes: ["x"] },
    };
    payload.sections.keyTerms = [];
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).not.toThrow();
  });
});
