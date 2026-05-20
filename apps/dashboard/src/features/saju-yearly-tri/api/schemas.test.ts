// v0.3.1 yearly LLM 출력 zod 스키마 단위 테스트.
// lifetime schemas.test.ts 패턴 미러링. 분량만 yearly 정책 (narrativeText 1200~2000) 으로 조정.
import { describe, expect, it } from "vitest";
import { SCHOOL_SCHEMAS } from "./schemas";

const dummy200 = "가".repeat(200);
const dummy1200 = "나".repeat(1200);

function baseOk() {
  return {
    narrativeText: dummy1200,
    sections: {
      personality: dummy200,
      career: dummy200,
      relationship: dummy200,
      health: dummy200,
      daeunSummary: dummy200,
      keyTerms: [
        { term: "從兒格", gloss: "종아격 — 일간이 식상에 종속" },
        { term: "食傷生財", gloss: "식상생재 — 식상이 재성을 생함" },
        { term: "歲運", gloss: "세운 — 올해 한 해의 운" },
      ],
      cautions: ["대운 전환기 주의"],
    },
    citations: ["적천수·통신론", "자평진전·격국편"],
  };
}

describe("yearly SCHOOL_SCHEMAS — ko", () => {
  it("유효 ko 페이로드 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["올해 도화살 강화"],
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

  it("cn-ziping schoolSpecific 을 ko 로 검증 → throw (분기 보장)", () => {
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

describe("yearly SCHOOL_SCHEMAS — cn-ziping", () => {
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

describe("yearly SCHOOL_SCHEMAS — cn-mangpai", () => {
  it("eventTimings 3건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: [
          { period: "Q1", event: "재물 변동" },
          { period: "Q2 중순", event: "가족 변고" },
          { period: "Q4", event: "이동·이사" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).not.toThrow();
  });

  it("eventTimings 2건 → throw (min 3)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: [
          { period: "a", event: "b" },
          { period: "c", event: "d" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).toThrow();
  });
});

describe("yearly SCHOOL_SCHEMAS — jp", () => {
  it("palaceMap 5건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "命宮(명궁)", note: "올해 본질" },
          { palace: "財帛宮(재백궁)", note: "올해 재물" },
          { palace: "兄弟宮(형제궁)", note: "올해 형제" },
          { palace: "田宅宮(전택궁)", note: "올해 부동산" },
          { palace: "官祿宮(관록궁)", note: "올해 직장" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).not.toThrow();
  });

  it("palaceMap 4건 → throw (min 5)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "a", note: "1" },
          { palace: "b", note: "2" },
          { palace: "c", note: "3" },
          { palace: "d", note: "4" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).toThrow();
  });
});

describe("yearly SCHOOL_SCHEMAS — 공통 base 검증", () => {
  it("narrativeText 1200자 미만 → throw", () => {
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
